using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Security;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class CategoriesController : ControllerBase
{
    private static readonly HashSet<string> AllowedStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "learning", "learned"
    };

    private readonly ApplicationDbContext _context;
    private readonly ActivityService _activityService;

    public CategoriesController(ApplicationDbContext context, ActivityService activityService)
    {
        _context = context;
        _activityService = activityService;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    [HttpGet]
    public async Task<ActionResult<List<object>>> GetCategories()
    {
        var userId = GetUserId();

            var progressByWord = await _context.UserCategoryWordProgresses
            .Where(p => p.UserId == userId)
            .ToDictionaryAsync(p => p.CategoryWordId, p => p.Status);

        var categories = await _context.Categories
            .Include(c => c.Words.Where(w => w.DeletedAt == null))
            .OrderBy(c => c.Id)
            .ToListAsync();

        var result = categories.Select(c =>
        {
            var learned = 0;
            var learning = 0;
            foreach (var word in c.Words)
            {
                if (progressByWord.TryGetValue(word.Id, out var status))
                {
                    if (status == "learned") learned++;
                    else learning++;
                }
            }

            return new
            {
                c.Id,
                c.Name,
                c.Slug,
                c.Icon,
                c.Color,
                c.Description,
                WordCount = c.Words.Count,
                Learned = learned,
                Learning = learning,
                NotStarted = c.Words.Count - learned - learning
            };
        }).ToList();

        return Ok(result);
    }

    [HttpGet("{slug}/words")]
    public async Task<ActionResult<object>> GetWords(string slug)
    {
        var category = await _context.Categories
            // Удалённые слова отсекаются явно: у CategoryWord нет глобального
            // фильтра (см. комментарий в ApplicationDbContext), потому что
            // фильтр сломал бы чтение прогресса пользователя.
            .Include(c => c.Words.Where(w => w.DeletedAt == null))
            .FirstOrDefaultAsync(c => c.Slug == slug);

        if (category == null) return NotFound();

        var userId = GetUserId();

        var wordIds = category.Words.Select(w => w.Id).ToList();
        var progressByWord = await _context.UserCategoryWordProgresses
            .Where(p => p.UserId == userId && wordIds.Contains(p.CategoryWordId))
            .ToDictionaryAsync(p => p.CategoryWordId, p => p.Status);

        var texts = category.Words.Select(w => w.English.ToLower()).ToList();
        var userWordTexts = await _context.UserWords
            .Where(uw => uw.UserId == userId && texts.Contains(uw.Word.Text.ToLower()))
            .Select(uw => uw.Word.Text)
            .ToListAsync();
        var userWordSet = userWordTexts.ToHashSet(StringComparer.OrdinalIgnoreCase);

        var words = category.Words
            .OrderBy(w => w.Id)
            .Select(w => new
            {
                w.Id,
                w.English,
                w.Translation,
                w.Transcription,
                w.Example,
                w.ImageUrl,
                Status = progressByWord.TryGetValue(w.Id, out var status) ? status : "not_started",
                InDictionary = userWordSet.Contains(w.English)
            })
            .ToList();

        // Перевод примера берём из справочника WordLevels (R11): в Categories
        // поле Example есть только по-английски, а карточке нужна пара.
        var categoryExamples = await _context.WordLevels
            .AsNoTracking()
            .Where(level => texts.Contains(level.Text) && level.ExampleRu != null)
            .Select(level => new { level.Text, level.Example, level.ExampleRu })
            .ToDictionaryAsync(level => level.Text, level => level, StringComparer.OrdinalIgnoreCase);

        var wordsWithExamples = words
            .Select(w =>
            {
                var reference = categoryExamples.GetValueOrDefault(w.English.ToLowerInvariant());
                var example = string.IsNullOrWhiteSpace(reference?.Example) ? w.Example : reference!.Example;
                return new
                {
                    w.Id,
                    w.English,
                    w.Translation,
                    w.Transcription,
                    Example = example,
                    // Перевод относим только к тому примеру, что реально вернули:
                    // иначе под английской фразой из категории стоял бы перевод
                    // другой фразы из справочника.
                    ExampleRu = example == reference?.Example ? reference?.ExampleRu : null,
                    w.ImageUrl,
                    w.Status,
                    w.InDictionary
                };
            })
            .ToList();

        return Ok(new
        {
            category.Id,
            category.Name,
            category.Slug,
            category.Icon,
            category.Color,
            category.Description,
            Words = wordsWithExamples
        });
    }

    [HttpPost("words/{id}/progress")]
    public async Task<ActionResult<object>> UpdateProgress(int id, [FromBody] UpdateCategoryWordProgressRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Status) || !AllowedStatuses.Contains(request.Status))
        {
            return BadRequest(new { message = "Status must be 'learning' or 'learned'" });
        }

        var wordExists = await _context.CategoryWords.AnyAsync(w => w.Id == id);
        if (!wordExists) return NotFound();

        var userId = GetUserId();
        var status = request.Status.ToLowerInvariant();

        var progress = await _context.UserCategoryWordProgresses
            .FirstOrDefaultAsync(p => p.UserId == userId && p.CategoryWordId == id);

        // XP даём только за переход в learned: переключение туда-обратно
        // не должно фармить награду повторно
        var wasLearned = string.Equals(progress?.Status, "learned", StringComparison.OrdinalIgnoreCase);

        if (progress == null)
        {
            progress = new UserCategoryWordProgress
            {
                UserId = userId,
                CategoryWordId = id,
                Status = status,
                UpdatedAt = DateTime.UtcNow
            };
            _context.UserCategoryWordProgresses.Add(progress);
        }
        else
        {
            progress.Status = status;
            progress.UpdatedAt = DateTime.UtcNow;
        }

        await _context.SaveChangesAsync();

        if (status == "learned" && !wasLearned)
        {
            await _activityService.TrackAsync(userId, "category_word", 1);
        }

        return Ok(new { progress.CategoryWordId, progress.Status, progress.UpdatedAt });
    }

    [HttpPost]
    [Route("/api/admin/seed-categories")]
    [Authorize(Roles = AppRoles.Admin)]
    [EnableRateLimiting("admin")]
    public async Task<ActionResult<object>> SeedCategories(
        [FromServices] CategorySeeder seeder,
        [FromServices] ContentCacheInvalidator cache)
    {
        var result = await seeder.SeedAsync();

        // Сид меняет состав категорий; без сброса витрины ещё до 6 часов
        // показывали бы прежний набор.
        cache.InvalidateCategories();

        if (result.Error != null)
        {
            return BadRequest(new { message = result.Error });
        }

        return Ok(new
        {
            alreadySeeded = result.AlreadySeeded,
            categoriesCreated = result.CategoriesCreated,
            wordsCreated = result.WordsCreated
        });
    }
}

public class UpdateCategoryWordProgressRequest
{
    public string Status { get; set; } = string.Empty;
}
