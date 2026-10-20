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
    private const int CheckpointQuestionCount = 15;
    private const int MinCheckpointWords = 4; // 3 дистрактора + правильный ответ

    // Уровни, которые реально есть в справочнике WordLevels
    private static readonly string[] CheckpointLevels = { "a1", "a2", "b1", "b2" };

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

    // GET: api/practice/checkpoint?level=b1
    // Чекпоинт-тест уровня: 15 вопросов в формате quiz, собранных из слов
    // пользователя, чей CEFR-уровень в справочнике WordLevels совпадает
    // с запрошенным. Если слов нужного уровня не хватает — добираем любыми
    // другими: частичный тест полезнее пустого экрана.
    [HttpGet("checkpoint")]
    public async Task<IActionResult> GetCheckpoint([FromQuery] string? level, [FromQuery] bool preview = false)
    {
        var userId = GetUserId();

        var normalized = (level ?? string.Empty).Trim().ToLowerInvariant();
        if (normalized.Length == 0)
        {
            // Уровень не передали — берём целевой уровень из профиля
            normalized = (await _context.Users.AsNoTracking()
                .Where(u => u.Id == userId)
                .Select(u => u.CefrLevel)
                .FirstOrDefaultAsync() ?? "b1").ToLowerInvariant();
        }

        if (!CheckpointLevels.Contains(normalized))
        {
            return BadRequest(new
            {
                error = $"Неизвестный уровень «{normalized}».",
                supportedLevels = CheckpointLevels
            });
        }

        var userWords = await _context.UserWords.AsNoTracking()
            .Where(uw => uw.UserId == userId)
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .ToListAsync();

        // Уровни тянем одним запросом по текстам слов — тот же справочник,
        // что использует BookAnalyzerService
        var texts = userWords
            .Select(uw => uw.Word.Text)
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var levelRows = texts.Count == 0
            ? new List<WordLevel>()
            : await _context.WordLevels.AsNoTracking()
                .Where(wl => texts.Contains(wl.Text))
                .ToListAsync();

        var levelByText = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in levelRows)
        {
            levelByText[row.Text] = row.CefrLevel;
        }

        var pool = userWords
            .Select(uw => new CheckpointCandidate(
                uw.WordId,
                uw.Word.Text,
                uw.Word.Definitions
                    .OrderBy(d => d.DisplayOrder)
                    .Select(d => d.Definition)
                    .FirstOrDefault() ?? string.Empty,
                levelByText.TryGetValue(uw.Word.Text, out var lv) ? lv : null))
            .Where(c => !string.IsNullOrWhiteSpace(c.Text) && !string.IsNullOrWhiteSpace(c.Definition))
            .GroupBy(c => c.WordId)
            .Select(g => g.First())
            .ToList();

        var ofLevel = pool
            .Where(c => string.Equals(c.Level, normalized, StringComparison.OrdinalIgnoreCase))
            .OrderBy(_ => Guid.NewGuid())
            .ToList();

        var selected = ofLevel.Take(CheckpointQuestionCount).ToList();

        // Дашборду нужны только счётчики: генерировать 15 вопросов ради
        // карточки «Чекпоинт B1» незачем
        if (preview)
        {
            return Ok(new
            {
                level = normalized,
                matchedWords = ofLevel.Count,
                dictionaryWords = pool.Count,
                requiredWords = MinCheckpointWords,
                available = pool.Count >= MinCheckpointWords,
                questionCapacity = Math.Min(CheckpointQuestionCount, pool.Count)
            });
        }

        if (selected.Count < CheckpointQuestionCount)
        {
            // Добор словами других уровней — без повторов уже выбранных
            var selectedIds = selected.Select(c => c.WordId).ToHashSet();
            var filler = pool
                .Where(c => !selectedIds.Contains(c.WordId))
                .OrderBy(_ => Guid.NewGuid())
                .Take(CheckpointQuestionCount - selected.Count);

            selected.AddRange(filler);
        }

        var distinctDefinitions = pool
            .Select(c => c.Definition)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();

        // Для дистракторов нужно минимум 4 разных перевода — иначе вопрос
        // не собрать. Пустой ответ здесь не ошибка, а «пока нечего тестировать».
        if (selected.Count < MinCheckpointWords || distinctDefinitions < MinCheckpointWords)
        {
            return Ok(new
            {
                level = normalized,
                questions = Array.Empty<object>(),
                reason = "not_enough_words",
                requiredWords = MinCheckpointWords,
                currentWords = selected.Count,
                matchedWords = ofLevel.Count,
                dictionaryWords = pool.Count
            });
        }

        var questions = new List<object>();

        foreach (var candidate in selected)
        {
            var distractors = new List<string>();
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { candidate.Definition };

            // Сначала берём дистракторы того же уровня — так тест проверяет
            // именно целевой пласт лексики, а не случайные простые слова
            foreach (var source in new[] { ofLevel, pool })
            {
                foreach (var other in source.OrderBy(_ => Guid.NewGuid()))
                {
                    if (distractors.Count >= 3) break;
                    if (!used.Add(other.Definition)) continue;
                    distractors.Add(other.Definition);
                }

                if (distractors.Count >= 3) break;
            }

            if (distractors.Count < 3) continue;

            var options = distractors
                .Append(candidate.Definition)
                .OrderBy(_ => Guid.NewGuid())
                .ToList();

            questions.Add(new
            {
                wordId = candidate.WordId,
                text = candidate.Text,
                level = candidate.Level ?? "unknown",
                options,
                correctIndex = options.IndexOf(candidate.Definition)
            });
        }

        if (questions.Count == 0)
        {
            return Ok(new
            {
                level = normalized,
                questions = Array.Empty<object>(),
                reason = "not_enough_words",
                requiredWords = MinCheckpointWords,
                currentWords = selected.Count,
                matchedWords = ofLevel.Count,
                dictionaryWords = pool.Count
            });
        }

        return Ok(new
        {
            level = normalized,
            requested = CheckpointQuestionCount,
            totalQuestions = questions.Count,
            matchedWords = ofLevel.Count,
            dictionaryWords = pool.Count,
            // Зачёт с 80% верных ответов
            passScore = (int)Math.Ceiling(questions.Count * 0.8),
            questions
        });
    }

    private sealed record CheckpointCandidate(int WordId, string Text, string Definition, string? Level);

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
