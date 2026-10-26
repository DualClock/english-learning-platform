using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

/// <summary>Одна пара «слово → пример» из Data/Seed/word-examples.json.</summary>
public sealed record WordExampleEntry(string Text, string Example, string ExampleRu);

public sealed class WordExampleSeedResult
{
    /// <summary>Словам без примера пример проставлен.</summary>
    public int Updated { get; set; }

    /// <summary>У слова уже был пример — сид его не трогает.</summary>
    public int Skipped { get; set; }

    /// <summary>Слова нет в WordLevels (опечатка в сиде или слово вне справочника).</summary>
    public int NotFound { get; set; }

    /// <summary>Строка не годится для записи: нет пары, пустая или длиннее колонки.</summary>
    public int Rejected { get; set; }

    public string? Error { get; set; }
}

/// <summary>
/// Примеры к словам A1/A2 (docs/execution/PHASE2_CONTRACT.md, R11).
///
/// Почему отдельный сид и отдельный файл: wordlists.json — словарь из 4500
/// частотных слов, он же источник списков «Essential/Core/Advanced»; писать в
/// него примеры значит перегенерировать 4500 строк ради 1500 и потерять
/// возможность обновлять примеры отдельно от словаря.
///
/// Идемпотентность держится на «не перезаписывать непустое поле»: пример в
/// базе мог быть исправлен руками, и повторный старт API не должен откатывать
/// правку к тексту из файла. Счётчики возвращаются наружу, чтобы старт был
/// виден в журнале, а не «что-то произошло».
/// </summary>
public class WordExampleSeeder
{
    /// <summary>
    /// Потолок колонки WordLevels.Example/ExampleRu. Строка длиннее отклоняется
    /// целиком: обрезка оставила бы половину предложения, и пользователь читал
    /// бы «The river was deep and co…» как ошибку карточки.
    /// </summary>
    public const int MaxExampleLength = 500;

    public const string SeedFileRelativePath = "Data/Seed/word-examples.json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<WordExampleSeeder> _logger;

    public WordExampleSeeder(
        ApplicationDbContext context,
        IWebHostEnvironment environment,
        ILogger<WordExampleSeeder> logger)
    {
        _context = context;
        _environment = environment;
        _logger = logger;
    }

    private string SeedFilePath => Path.Combine(_environment.ContentRootPath, SeedFileRelativePath);

    public Task<WordExampleSeedResult> SeedAsync(CancellationToken ct = default) =>
        SeedAsync(SeedFilePath, ct);

    /// <summary>
    /// Перегруз с явным путём: тесты гоняют сидер на временном файле, не
    /// собирая вокруг него фейковый корень приложения.
    /// </summary>
    public async Task<WordExampleSeedResult> SeedAsync(string seedFilePath, CancellationToken ct = default)
    {
        var result = new WordExampleSeedResult();

        var entries = ParseSeed(seedFilePath, out var error);
        if (error != null)
        {
            result.Error = error;
            return result;
        }

        // Дедупликация до запроса в БД: ApplyAsync пишет по тексту, и две строки
        // с одним text дали бы «обновлено 2» при одной колонке.
        var unique = entries
            .GroupBy(e => e.Text.Trim().ToLowerInvariant())
            .Select(g => g.First())
            .ToList();

        var texts = unique.Select(e => e.Text).ToList();

        // Один round-trip на весь файл: 1500 слов одним IN дешевле, чем 1500
        // запросов по PK, и не держит транзакцию на время разбора.
        var byText = await _context.WordLevels
            .Where(wl => texts.Contains(wl.Text))
            .ToDictionaryAsync(wl => wl.Text, StringComparer.OrdinalIgnoreCase, ct);

        foreach (var entry in unique)
        {
            if (!IsUsablePair(entry.Example, entry.ExampleRu))
            {
                result.Rejected++;
                continue;
            }

            if (!byText.TryGetValue(entry.Text, out var level))
            {
                result.NotFound++;
                continue;
            }

            if (!string.IsNullOrWhiteSpace(level.Example))
            {
                result.Skipped++;
                continue;
            }

            level.Example = entry.Example;
            level.ExampleRu = entry.ExampleRu;
            result.Updated++;
        }

        if (result.Updated > 0)
        {
            await _context.SaveChangesAsync(ct);
        }

        _logger.LogInformation(
            "Примеры к словам: обновлено {Updated}, пропущено {Skipped}, не найдено {NotFound}, отклонено {Rejected}",
            result.Updated, result.Skipped, result.NotFound, result.Rejected);

        return result;
    }

    /// <summary>
    /// Пара пишется только целиком: английское предложение без перевода —
    /// половина карточки, которую ученик A1/A2 не прочтёт.
    /// </summary>
    public static bool IsUsablePair(string? example, string? exampleRu) =>
        !string.IsNullOrWhiteSpace(example)
        && !string.IsNullOrWhiteSpace(exampleRu)
        && example.Trim().Length <= MaxExampleLength
        && exampleRu.Trim().Length <= MaxExampleLength;

    /// <summary>
    /// Чтение файла без броска исключения: битый JSON — это Error в результате,
    /// а не падение старта API (тот же контракт, что у WordListSeeder).
    /// </summary>
    public static List<WordExampleEntry> ParseSeed(string seedFilePath, out string? error)
    {
        error = null;
        if (!File.Exists(seedFilePath))
        {
            error = "Seed file not found: " + Path.GetFileName(seedFilePath);
            return new List<WordExampleEntry>();
        }

        List<RawEntry>? raw;
        try
        {
            raw = JsonSerializer.Deserialize<List<RawEntry>>(File.ReadAllText(seedFilePath), JsonOptions);
        }
        catch (JsonException ex)
        {
            error = "Failed to parse seed file: " + ex.Message;
            return new List<WordExampleEntry>();
        }

        if (raw == null || raw.Count == 0)
        {
            error = "Seed file contains no examples";
            return new List<WordExampleEntry>();
        }

        return raw
            .Where(e => !string.IsNullOrWhiteSpace(e.Text))
            .Select(e => new WordExampleEntry(
                e.Text.Trim().ToLowerInvariant(),
                (e.Example ?? string.Empty).Trim(),
                (e.ExampleRu ?? string.Empty).Trim()))
            .ToList();
    }

    /// <summary>
    /// Санитарная проверка контента, а не обучение модели: предложение из одного-
    /// двух слов («A river.») примером не является, а последовательность русских
    /// букв в английском поле — признак перепутанных колонок.
    /// </summary>
    public static bool LooksLikeSentence(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;

        var trimmed = text.Trim();
        if (!char.IsLetter(trimmed[0]) || !char.IsUpper(trimmed[0])) return false;

        var words = trimmed
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Count(w => w.Any(char.IsLetter));
        if (words < 3) return false;

        char last = trimmed[^1];
        return last is '.' or '!' or '?' or '…' or '"';
    }

    /// <summary>
    /// Русское предложение: есть кириллица, нет английских служебных слов.
    /// </summary>
    public static bool LooksLikeRussian(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;

        var trimmed = text.Trim();
        if (!trimmed.Any(ch => ch >= 'А' && ch <= 'я' || ch is 'Ё' or 'ё')) return false;
        if (!char.IsUpper(trimmed[0])) return false;

        var last = trimmed[^1];
        if (last is not ('.' or '!' or '?' or '…' or '"'))
        {
            return false;
        }

        var words = trimmed
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Count(w => w.Any(char.IsLetter));
        return words >= 2;
    }

    private sealed class RawEntry
    {
        public string? Text { get; set; }
        public string? Example { get; set; }
        public string? ExampleRu { get; set; }
    }
}
