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

    // POST: api/practice/writing/submitted — отметка письменной практики (XP)
    [HttpPost("writing/submitted")]
    public async Task<IActionResult> SubmitWriting([FromBody] WritingSubmitRequest? request)
    {
        var wordCount = Math.Clamp(request?.WordCount ?? 0, 0, 5000);

        await _activityService.TrackAsync(GetUserId(), "writing_submitted", 1);

        return Ok(new { tracked = true, wordCount });
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
    // собираем естественную фразу с целевым словом. Каркасы разные и
    // выбираются по хэшу слова: пять предложений подряд не должны звучать
    // как одно и то же.
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
        var posSentence = partOfSpeech switch
        {
            "noun" => $"The word {term} is a noun we often use in everyday English.",
            "verb" => $"The word {term} is a verb you can use in everyday English.",
            "adjective" or "adj" => $"The word {term} is an adjective we often use in everyday English.",
            "adverb" or "adv" => $"The word {term} is an adverb you can use in everyday English.",
            _ => null
        };

        if (posSentence != null)
        {
            return posSentence;
        }

        // Стабильный выбор каркаса: string.GetHashCode рандомизирован между
        // запусками, поэтому считаем свой простой хэш
        var hash = 0;
        foreach (var ch in term.ToLowerInvariant())
        {
            hash = (hash * 31 + ch) & 0x7fffffff;
        }

        var index = hash % Frames.Length;
        return Frames[index].Replace("{w}", term, StringComparison.Ordinal);
    }

    private static readonly string[] Frames =
    {
        "I learned the word {w} from a book last week.",
        "Could you explain what {w} means in this sentence?",
        "She wrote {w} on the board and asked us to repeat it.",
        "The teacher says {w} is a common word in English.",
        "Try to use {w} when you speak English today.",
        "He looked up {w} in the dictionary before the lesson.",
        "We practised the word {w} again and again.",
        "Do you remember how to spell {w}?"
    };
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

public class WritingSubmitRequest
{
    public int WordCount { get; set; }
}
