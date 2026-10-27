using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

// GET /api/welcome — данные для экрана «С возвращением!».
// Порог отсутствия и число элементов настраиваются в appsettings (секция Welcome).
[ApiController]
[Route("api/welcome")]
[Authorize]
public class WelcomeController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;

    public WelcomeController(ApplicationDbContext context, IConfiguration configuration)
    {
        _context = context;
        _configuration = configuration;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    [HttpGet]
    public async Task<IActionResult> GetWelcome()
    {
        var userId = GetUserId();
        var today = DateTime.UtcNow.Date;

        var user = await _context.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.LastActivityDate, u.CreatedAt, u.CefrLevel })
            .FirstOrDefaultAsync();
        if (user == null) return NotFound();

        // Нет истории активности (новый аккаунт) — возвращаться нечему
        var lastActive = user.LastActivityDate?.Date ?? user.CreatedAt.Date;
        var daysSince = (int)(today - lastActive).TotalDays;

        int threshold = _configuration.GetValue("Welcome:AbsenceThresholdDays", 3);
        int maxItems = Math.Max(1, _configuration.GetValue("Welcome:MaxItems", 4));

        if (daysSince < threshold)
        {
            return Ok(new { daysSinceLastActivity = daysSince, show = false, items = Array.Empty<object>() });
        }

        var items = new List<WelcomeItem>();

        // 1. Слова на повторение: просроченные по SRS + «слабые» (короткий интервал — много ошибок)
        var now = DateTime.UtcNow;
        var wordStats = await _context.UserWords.AsNoTracking()
            .Where(uw => uw.UserId == userId)
            .Select(uw => new
            {
                uw.WordId,
                uw.Word.Text,
                Due = uw.NextReviewDate != null && uw.NextReviewDate <= now,
                Weak = uw.Interval <= 1 && uw.RepetitionCount >= 1 && uw.LastReviewedAt != null
            })
            .ToListAsync();

        var reviewWords = wordStats.Where(w => w.Due || w.Weak)
            .OrderByDescending(w => w.Due) // сперва просроченные
            .ThenBy(w => w.WordId)
            .ToList();

        if (reviewWords.Count > 0)
        {
            items.Add(new WelcomeItem(
                Type: "words",
                Title: "Слова на повторение",
                Subtitle: $"{reviewWords.Count} слов ждут повторения",
                Meta: string.Join(", ", reviewWords.Take(3).Select(w => w.Text)) +
                      (reviewWords.Count > 3 ? "…" : ""),
                BookId: null, UnitId: null, Page: null));
        }

        // 2. Незавершённая книга — самая продвинутая из начатых
        var book = await _context.Books.AsNoTracking()
            .Where(b => b.UploadedByUserId == userId && b.Progress > 0 && b.Progress < 100)
            .OrderByDescending(b => b.Progress)
            .Select(b => new { b.Id, b.Title, b.Author, b.CurrentPage, b.TotalPages, b.Progress })
            .FirstOrDefaultAsync();

        if (book != null)
        {
            items.Add(new WelcomeItem(
                Type: "book",
                Title: book.Title,
                Subtitle: book.Author,
                Meta: $"стр. {book.CurrentPage} из {book.TotalPages} · {Math.Round(book.Progress)}%",
                BookId: book.Id, UnitId: null, Page: book.CurrentPage));
        }

        // 3. Следующий урок грамматики: первый незавершённый по программе
        // (если определён уровень пользователя — первый незавершённый его уровня)
        var completedUnitIds = await _context.UserGrammarProgresses.AsNoTracking()
            .Where(p => p.UserId == userId)
            .Select(p => p.UnitId)
            .ToListAsync();
        var completed = completedUnitIds.ToHashSet();

        var nextUnits = await _context.GrammarUnits.AsNoTracking()
            .OrderBy(u => u.Order)
            .Select(u => new { u.Id, u.Order, u.Title, u.CefrLevel })
            .ToListAsync();

        var nextUnit = nextUnits.FirstOrDefault(u => !completed.Contains(u.Id));
        if (!string.IsNullOrEmpty(user.CefrLevel))
        {
            var atLevel = nextUnits.FirstOrDefault(u => !completed.Contains(u.Id)
                && string.Equals(u.CefrLevel, user.CefrLevel, StringComparison.OrdinalIgnoreCase));
            nextUnit = atLevel ?? nextUnit;
        }

        if (nextUnit != null)
        {
            items.Add(new WelcomeItem(
                Type: "lesson",
                Title: nextUnit.Title,
                Subtitle: $"Урок грамматики · уровень {nextUnit.CefrLevel.ToUpper()}",
                Meta: null,
                BookId: null, UnitId: nextUnit.Id, Page: null));
        }

        return Ok(new
        {
            daysSinceLastActivity = daysSince,
            show = items.Count > 0,
            items = items.Take(maxItems)
        });
    }

    public record WelcomeItem(
        string Type,
        string Title,
        string? Subtitle,
        string? Meta,
        int? BookId,
        int? UnitId,
        int? Page);
}
