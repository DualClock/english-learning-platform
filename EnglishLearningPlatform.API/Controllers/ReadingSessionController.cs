using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Controllers;

public class ReadingSession
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public int BookId { get; set; }
    public DateTime StartedAtUtc { get; set; }
    public List<SessionWord> Words { get; set; } = new();
}

public class SessionWord
{
    public string Text { get; set; } = string.Empty;
    public int Page { get; set; }
    public string? ContextSentence { get; set; }
}

[ApiController]
[Route("api/reading/sessions")]
[Authorize]
public class ReadingSessionController : ControllerBase
{
    private static readonly TimeSpan SessionTtl = TimeSpan.FromHours(12);

    private readonly ApplicationDbContext _context;
    private readonly DictionaryService _dictionaryService;
    private readonly ActivityService _activityService;
    private readonly IMemoryCache _cache;
    private readonly ILogger<ReadingSessionController> _logger;

    public ReadingSessionController(
        ApplicationDbContext context,
        DictionaryService dictionaryService,
        ActivityService activityService,
        IMemoryCache cache,
        ILogger<ReadingSessionController> logger)
    {
        _context = context;
        _dictionaryService = dictionaryService;
        _activityService = activityService;
        _cache = cache;
        _logger = logger;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    private static string SessionKey(Guid id) => $"readingsession:{id}";

    private ReadingSession? GetSession(Guid id, string userId)
    {
        if (!_cache.TryGetValue(SessionKey(id), out ReadingSession? session) || session == null)
            return null;
        if (session.UserId != userId) return null;
        return session;
    }

    // POST: api/reading/sessions
    [HttpPost]
    public async Task<IActionResult> StartSession([FromBody] StartSessionRequest request)
    {
        var userId = GetUserId();

        var book = await _context.Books.AsNoTracking()
            .FirstOrDefaultAsync(b => b.Id == request.BookId && b.UploadedByUserId == userId);
        if (book == null) return NotFound(new { message = "Book not found" });

        var session = new ReadingSession
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            BookId = request.BookId,
            StartedAtUtc = DateTime.UtcNow
        };

        _cache.Set(SessionKey(session.Id), session, SessionTtl);
        return Ok(new { sessionId = session.Id });
    }

    // POST: api/reading/sessions/{id}/words
    [HttpPost("{id}/words")]
    public IActionResult AddWord(Guid id, [FromBody] AddSessionWordRequest request)
    {
        var session = GetSession(id, GetUserId());
        if (session == null) return NotFound(new { message = "Session not found" });

        var text = (request.Text ?? "").Trim().ToLowerInvariant();
        if (text.Length < 2) return BadRequest(new { message = "Invalid word" });

        if (!session.Words.Any(w => w.Text == text))
        {
            session.Words.Add(new SessionWord
            {
                Text = text,
                Page = request.Page,
                ContextSentence = Truncate(request.ContextSentence, 500)
            });
        }

        return Ok(new { count = session.Words.Count });
    }

    // DELETE: api/reading/sessions/{id}/words/{text}
    [HttpDelete("{id}/words/{text}")]
    public IActionResult RemoveWord(Guid id, string text)
    {
        var session = GetSession(id, GetUserId());
        if (session == null) return NotFound(new { message = "Session not found" });

        var normalized = text.Trim().ToLowerInvariant();
        session.Words.RemoveAll(w => w.Text == normalized);
        return Ok(new { count = session.Words.Count });
    }

    // GET: api/reading/sessions/{id}
    [HttpGet("{id}")]
    public IActionResult GetSession(Guid id)
    {
        var session = GetSession(id, GetUserId());
        if (session == null) return NotFound(new { message = "Session not found" });

        return Ok(new
        {
            bookId = session.BookId,
            minutes = Math.Max(1, (int)Math.Ceiling((DateTime.UtcNow - session.StartedAtUtc).TotalMinutes / 2.0)),
            words = session.Words.Select(w => new { text = w.Text, page = w.Page, contextSentence = w.ContextSentence })
        });
    }

    // POST: api/reading/sessions/{id}/finish
    [HttpPost("{id}/finish")]
    public async Task<IActionResult> FinishSession(Guid id)
    {
        var userId = GetUserId();
        var session = GetSession(id, userId);
        if (session == null) return NotFound(new { message = "Session not found" });

        var uniqueWords = session.Words
            .GroupBy(w => w.Text, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        // Переводы из справочника WordLevels
        var texts = uniqueWords.Select(w => w.Text).ToList();
        var levelMap = await _context.WordLevels.AsNoTracking()
            .Where(wl => texts.Contains(wl.Text))
            .ToDictionaryAsync(wl => wl.Text, wl => wl.TranslationRu, StringComparer.OrdinalIgnoreCase);

        var added = 0;
        foreach (var word in uniqueWords)
        {
            var definition = levelMap.TryGetValue(word.Text, out var ru) && !string.IsNullOrWhiteSpace(ru)
                ? ru
                : "(добавлено из чтения)";

            var result = await _dictionaryService.AddWordAsync(userId, new Models.DTOs.AddWordRequest(
                word.Text,
                definition,
                null,
                word.ContextSentence,
                null
            ), source: "reader");

            if (result != null) added++;
        }

        var minutes = Math.Max(1, (int)Math.Ceiling((DateTime.UtcNow - session.StartedAtUtc).TotalMinutes / 2.0));
        if (uniqueWords.Count > 0)
        {
            await _activityService.TrackAsync(userId, "read_page", minutes);
            await _activityService.TrackAsync(userId, "quiz_done", 1);
        }

        var quiz = BuildQuiz(uniqueWords, levelMap);

        _cache.Remove(SessionKey(session.Id));

        return Ok(new { quiz, added, minutes });
    }

    private static object BuildQuiz(List<SessionWord> words, Dictionary<string, string?> levelMap)
    {
        var translated = words
            .Where(w => levelMap.TryGetValue(w.Text, out var ru) && !string.IsNullOrWhiteSpace(ru))
            .Take(10)
            .ToList();

        if (translated.Count < 4) return new { questions = Array.Empty<object>() };

        var allTranslations = translated.Select(w => levelMap[w.Text]!).Distinct().ToList();
        var rng = new Random();
        var questions = new List<object>();

        foreach (var word in translated)
        {
            var correct = levelMap[word.Text]!;
            var distractors = allTranslations
                .Where(t => t != correct)
                .OrderBy(_ => rng.Next())
                .Take(3)
                .ToList();

            if (distractors.Count < 3) continue;

            var options = new List<string> { correct };
            options.AddRange(distractors);
            // перемешиваем варианты
            options = options.OrderBy(_ => rng.Next()).ToList();

            questions.Add(new
            {
                wordText = word.Text,
                options,
                correctIndex = options.IndexOf(correct)
            });
        }

        return new { questions };
    }

    private static string? Truncate(string? s, int max) =>
        string.IsNullOrEmpty(s) ? s : (s.Length <= max ? s : s[..max]);
}

public class StartSessionRequest
{
    public int BookId { get; set; }
}

public class AddSessionWordRequest
{
    public string Text { get; set; } = string.Empty;
    public int Page { get; set; }
    public string? ContextSentence { get; set; }
}
