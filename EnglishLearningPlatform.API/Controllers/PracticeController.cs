using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/practice")]
[Authorize]
public class PracticeController : ControllerBase
{
    private const int MaxDictationCount = 10;

    private readonly ApplicationDbContext _context;
    private readonly ActivityService _activityService;

    public PracticeController(ApplicationDbContext context, ActivityService activityService)
    {
        _context = context;
        _activityService = activityService;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // GET: api/practice/dictation?count=5
    // Предложения для диктанта: сначала реальные примеры из словаря пользователя,
    // для слов без примера — нейтральный шаблон по части речи.
    [HttpGet("dictation")]
    public async Task<IActionResult> GetDictation([FromQuery] int count = 5)
    {
        var userId = GetUserId();
        var take = Math.Clamp(count, 1, MaxDictationCount);

        // Берём с запасом: часть слов может отсеяться (дубли предложений, пустые определения)
        var words = await _context.UserWords.AsNoTracking()
            .Where(uw => uw.UserId == userId)
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .OrderBy(_ => Guid.NewGuid())
            .Take(take * 4)
            .ToListAsync();

        if (words.Count == 0)
        {
            return Ok(new
            {
                items = Array.Empty<object>(),
                reason = "empty_dictionary",
                requiredWords = 1,
                currentWords = 0
            });
        }

        var items = new List<object>();
        var seenSentences = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var uw in words)
        {
            if (items.Count >= take) break;

            var definition = uw.Word.Definitions
                .OrderBy(d => d.DisplayOrder)
                .FirstOrDefault();

            var sentence = BuildSentence(uw.Word, definition);
            if (string.IsNullOrWhiteSpace(sentence) || !seenSentences.Add(sentence))
            {
                continue;
            }

            items.Add(new
            {
                wordId = uw.WordId,
                word = uw.Word.Text,
                sentence,
                translation = definition?.Definition,
                partOfSpeech = definition?.PartOfSpeech
            });
        }

        return Ok(new
        {
            items,
            count = items.Count,
            requested = take
        });
    }

    // POST: api/practice/dictation/result
    // Результат одной попытки диктанта: XP начисляется за каждое проверенное слово.
    [HttpPost("dictation/result")]
    public async Task<IActionResult> SubmitDictation([FromBody] DictationResultRequest request)
    {
        var results = request?.Results ?? new List<DictationResultItem>();
        if (results.Count == 0)
        {
            return BadRequest(new { error = "Нет результатов для сохранения." });
        }

        if (results.Count > MaxDictationCount)
        {
            return BadRequest(new { error = $"Слишком много результатов за раз (максимум {MaxDictationCount})." });
        }

        var userId = GetUserId();
        var correct = results.Count(r => r.Correct);

        foreach (var _ in results)
        {
            await _activityService.TrackAsync(userId, "dictation_word", 1);
        }

        return Ok(new
        {
            checkedCount = results.Count,
            correct,
            accuracy = results.Count == 0 ? 0 : Math.Round(correct * 100.0 / results.Count, 0)
        });
    }

    // GET: api/practice/minimal-pairs — статический набор пар для тренировки слуха
    [HttpGet("minimal-pairs")]
    public IActionResult GetMinimalPairs()
    {
        var pairs = MinimalPairCatalog.Pairs.Select(p => new
        {
            id = p.Id,
            a = new { word = p.WordA, ipa = p.IpaA, translation = p.RuA },
            b = new { word = p.WordB, ipa = p.IpaB, translation = p.RuB },
            tip = p.Tip
        });

        return Ok(new { pairs, total = MinimalPairCatalog.Pairs.Count });
    }

    // Пример из словаря — лучший материал для диктанта. Если его нет,
    // собираем нейтральную фразу по части речи: она всегда на английском
    // и не тащит в аудио русский перевод.
    internal static string BuildSentence(Word word, WordDefinition? definition)
    {
        var example = definition?.Example?.Trim();
        if (!string.IsNullOrWhiteSpace(example) && example.Length >= 12)
        {
            return example;
        }

        var term = word.Text.Trim();
        if (term.Length == 0)
        {
            return string.Empty;
        }

        var partOfSpeech = definition?.PartOfSpeech?.Trim().ToLowerInvariant();

        return partOfSpeech switch
        {
            "noun" => $"The word {term} is a noun we often use in everyday English.",
            "verb" => $"The word {term} is a verb you can use in everyday English.",
            "adjective" or "adj" => $"The word {term} is an adjective we often use in everyday English.",
            "adverb" or "adv" => $"The word {term} is an adverb you can use in everyday English.",
            _ => $"The word {term} is useful in everyday English."
        };
    }
}

public class DictationResultRequest
{
    public List<DictationResultItem>? Results { get; set; }
}

public class DictationResultItem
{
    public int WordId { get; set; }
    public bool Correct { get; set; }
}
