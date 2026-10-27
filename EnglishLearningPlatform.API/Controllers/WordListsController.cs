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
public class WordListsController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public WordListsController(ApplicationDbContext context)
    {
        _context = context;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    [HttpGet]
    public async Task<ActionResult<List<object>>> GetLists()
    {
        var userId = GetUserId();

        var userWordTexts = await _context.UserWords
            .Where(uw => uw.UserId == userId && uw.Source == "list")
            .Select(uw => uw.Word.Text)
            .ToListAsync();

        var lists = await _context.WordLists
            .Select(wl => new
            {
                wl.Id,
                wl.Name,
                wl.Description,
                wl.CefrFrom,
                wl.CefrTo,
                wl.ItemCount,
                LearnedCount = wl.Items.Count(wli => userWordTexts.Contains(wli.WordText))
            })
            .ToListAsync();

        return Ok(lists);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetList(int id, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 50;
        if (pageSize > 200) pageSize = 200;

        var list = await _context.WordLists
            .FirstOrDefaultAsync(wl => wl.Id == id);

        if (list == null) return NotFound();

        var userId = GetUserId();
        var userWordTexts = await _context.UserWords
            .Where(uw => uw.UserId == userId)
            .Select(uw => uw.Word.Text)
            .ToListAsync();
        var userWordSet = userWordTexts.ToHashSet(StringComparer.OrdinalIgnoreCase);

        var totalItems = await _context.WordListItems
            .CountAsync(wli => wli.ListId == id);

        var items = await _context.WordListItems
            .Where(wli => wli.ListId == id)
            .OrderBy(wli => wli.FreqRank)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(wli => new
            {
                wli.WordText,
                wli.CefrLevel,
                wli.FreqRank,
                InDictionary = userWordSet.Contains(wli.WordText)
            })
            .ToListAsync();

        return Ok(new
        {
            list.Id,
            list.Name,
            list.Description,
            Items = items,
            TotalItems = totalItems,
            Page = page,
            PageSize = pageSize
        });
    }

    [HttpPost]
    [Route("/api/admin/seed-wordlists")]
    [Authorize(Roles = AppRoles.Admin)]
    [EnableRateLimiting("admin")]
    public async Task<ActionResult<object>> SeedWordLists(
        [FromServices] WordListSeeder seeder,
        [FromServices] ContentCacheInvalidator cache)
    {
        var result = await seeder.SeedAsync();

        cache.InvalidateCategories();

        if (result.Error != null)
        {
            return BadRequest(new { message = result.Error });
        }

        return Ok(new
        {
            alreadySeeded = result.AlreadySeeded,
            wordLevelsSeeded = result.WordLevelsSeeded,
            listsCreated = result.ListsCreated
        });
    }

    [HttpPost("{id}/learn")]
    public async Task<ActionResult<object>> LearnWords(int id, [FromBody] LearnWordsRequest request)
    {
        var list = await _context.WordLists.FirstOrDefaultAsync(wl => wl.Id == id);
        if (list == null) return NotFound();

        var words = (request.Words ?? new List<string>())
            .Where(w => !string.IsNullOrWhiteSpace(w))
            .Select(w => w.Trim().ToLowerInvariant())
            .Distinct()
            .Take(500)
            .ToList();

        if (words.Count == 0)
        {
            return BadRequest(new { message = "No words provided" });
        }

        var userId = GetUserId();

        var existingWords = await _context.Words
            .Include(w => w.Definitions)
            .Where(w => words.Contains(w.Text.ToLower()))
            .ToListAsync();
        var wordByText = existingWords.ToDictionary(w => w.Text.ToLower(), StringComparer.OrdinalIgnoreCase);

        var existingUserWords = await _context.UserWords
            .Where(uw => uw.UserId == userId && words.Contains(uw.Word.Text.ToLower()))
            .ToListAsync();
        var existingUserWordTexts = existingUserWords
            .Select(uw => uw.Word.Text.ToLower())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var levels = await _context.WordLevels
            .Where(wl => words.Contains(wl.Text.ToLower()))
            .ToListAsync();
        var levelByText = levels.ToDictionary(l => l.Text.ToLower(), StringComparer.OrdinalIgnoreCase);

        var added = 0;
        var skipped = 0;

        // Батчевое сохранение: раньше внутри цикла был SaveChanges на каждое слово
        // (до 500 запросов). Теперь два SaveChanges внутри одной транзакции:
        // EF раздаёт сгенерированные ID всем отслеженным словам сразу.
        await using var transaction = await _context.Database.BeginTransactionAsync();

        foreach (var text in words)
        {
            if (existingUserWordTexts.Contains(text))
            {
                skipped++;
                continue;
            }

            if (!wordByText.TryGetValue(text, out var word))
            {
                word = new Word
                {
                    Text = text,
                    Language = "en"
                };

                if (levelByText.TryGetValue(text, out var level) &&
                    !string.IsNullOrWhiteSpace(level.TranslationRu))
                {
                    word.Definitions.Add(new WordDefinition
                    {
                        Definition = level.TranslationRu,
                        PartOfSpeech = null,
                        DisplayOrder = 0
                    });
                }

                _context.Words.Add(word);
                wordByText[text] = word;
            }
            else if (word.Definitions.Count == 0 &&
                     levelByText.TryGetValue(text, out var level) &&
                     !string.IsNullOrWhiteSpace(level.TranslationRu))
            {
                _context.WordDefinitions.Add(new WordDefinition
                {
                    WordId = word.Id,
                    Definition = level.TranslationRu,
                    PartOfSpeech = null,
                    DisplayOrder = 0
                });
                word.Definitions.Clear();
            }

            // Привязка через навигацию, а не WordId: у новых слов ID появится только при SaveChanges
            _context.UserWords.Add(new UserWord
            {
                UserId = userId,
                Word = word,
                Source = "list",
                NextReviewDate = DateTime.UtcNow
            });

            _context.Interactions.Add(new Interaction
            {
                UserId = userId,
                Word = word,
                Source = "list",
                ContextSentence = null
            });

            added++;
        }

        await _context.SaveChangesAsync();
        await transaction.CommitAsync();

        return Ok(new { added, skipped });
    }
}

public class LearnWordsRequest
{
    public List<string>? Words { get; set; }
}
