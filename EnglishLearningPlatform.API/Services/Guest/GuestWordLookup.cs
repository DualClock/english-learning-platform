using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services.Guest;

/// <summary>
/// Перевод слова для гостя — только из справочника WordLevels.
///
/// ЧЕГО ЗДЕСЬ СОЗНАТЕЛЬНО НЕТ:
///  - вызовов AI. Анонимный путь, который ходит в Gemini, — это открытый
///    кран: одна страница превью с сотней слов в кликах выжигает квоту
///    модели, а платим за это мы. Слово, которого нет в справочнике, честно
///    возвращает TranslationRu = null, и фронт показывает «перевод станет
///    доступен с аккаунтом»;
///  - записей в UserWords, ReaderPocketWords, UserBookProgresses. У гостя нет
///    пользователя, и любой INSERT от его имени был бы строкой-сиротой или,
///    хуже, записью в чужой карточке.
///
/// Каскад форм. Справочник (Data/Seed/wordlists.json) хранит базовые формы,
/// а в тексте приходят «walked», «stories», «thinking». Поэтому запрос идёт
/// по формам LemmatizerService.GetForms — тем же, что считает статистику
/// главы, — но в порядке «сначала точное совпадение, потом лемма, потом
/// регулярные варианты»: иначе «leaves» получило бы перевод листа, когда в
/// предложении это форма leave. Число запросов ограничено бюджетом из
/// <see cref="GuestPreviewOptions"/>.
///
/// Кэш: ключ `guest:word:{word}` (нормализованная форма) и TTL 6 часов. Ответ
/// «слова нет» тоже кэшируется — иначе поток кликов по незнакомым словам
/// превращается в поток запросов к БД.
/// </summary>
public class GuestWordLookup
{
    /// <summary>Потолок длины входа: справочник хранит до 100 символов.</summary>
    public const int MaxWordLength = 100;

    /// <summary>
    /// Однопроходная проверка на слово на процесс: два клика по одному слову
    /// из двух вкладок не должны давать два SQL-запроса.
    /// </summary>
    private readonly ConcurrentDictionary<string, Lazy<string?>> _inflight = new(StringComparer.Ordinal);

    private static readonly Regex AllowedWord = new(
        @"^[a-z][a-z'’\-]*$",
        RegexOptions.Compiled);

    private readonly ApplicationDbContext _context;
    private readonly LemmatizerService _lemmatizer;
    private readonly IMemoryCache _cache;
    private readonly GuestPreviewOptions _options;
    private readonly ILogger<GuestWordLookup> _logger;

    public GuestWordLookup(
        ApplicationDbContext context,
        LemmatizerService lemmatizer,
        IMemoryCache cache,
        ILogger<GuestWordLookup> logger,
        GuestPreviewOptions? options = null)
    {
        _context = context;
        _lemmatizer = lemmatizer;
        _cache = cache;
        _logger = logger;
        _options = options ?? new GuestPreviewOptions();
    }

    public static string CacheKey(string word) => $"guest:word:{word}";

    /// <summary>
    /// Перевод слова. Возвращает запись и для неизвестного слова
    /// (TranslationRu = null) — это не ошибка, а состояние, которое фронт
    /// показывает своим CTA.
    /// </summary>
    public async Task<GuestWordLookupDto?> LookupAsync(string? raw, CancellationToken ct = default)
    {
        var word = NormalizeInput(raw);
        if (word == null)
        {
            return null;
        }

        var key = CacheKey(word);
        if (_cache.TryGetValue(key, out GuestWordLookupDto? cached) && cached != null)
        {
            return cached;
        }

        // Lazy + GetOrAdd: гонка двух запросов одного слова схлопывается в одну
        // задачу; лишняя запись в словарь безвредна (тот же ключ, тот же
        // результат), поэтому снимать проигравшую запись не нужно.
        var lazy = _inflight.GetOrAdd(
            word,
            w => new Lazy<string?>(
                () => LookupEntryTextAsync(w, CancellationToken.None).GetAwaiter().GetResult(),
                LazyThreadSafetyMode.ExecutionAndPublication));

        string? entryText;
        try
        {
            entryText = lazy.Value;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Guest lookup: словарь недоступен для слова {Word}", word);
            return new GuestWordLookupDto { Word = word, Source = "unavailable" };
        }

        var dto = await BuildAsync(word, entryText, ct);
        _cache.Set(key, dto, _options.WordCacheTtl);
        return dto;
    }

    /// <summary>
    /// Ровно один запрос живёт в Lazy-словаре; он и заполняет кэш, чтобы
    /// следующий клик в другой вкладке уже не ходил в БД.
    /// </summary>
    private async Task<string?> LookupEntryTextAsync(string word, CancellationToken ct)
    {
        var forms = FormsToTry(word, _options.MaxWordLookupQueries);
        if (forms.Count == 0)
        {
            return null;
        }

        // Один round-trip на все формы: EF переводит Contains в IN, а порядок
        // предпочтения восстанавливается в памяти по списку forms.
        var rows = await _context.WordLevels.AsNoTracking()
            .Where(wl => forms.Contains(wl.Text))
            .Select(wl => wl.Text)
            .ToListAsync(ct);

        var found = new HashSet<string>(rows, StringComparer.OrdinalIgnoreCase);
        foreach (var form in forms)
        {
            if (found.Contains(form))
            {
                return form;
            }
        }

        return null;
    }

    private async Task<GuestWordLookupDto> BuildAsync(string word, string? entryText, CancellationToken ct)
    {
        if (entryText == null)
        {
            // Слова нет в справочнике: AI не зовём (см. комментарий класса).
            return new GuestWordLookupDto { Word = word, Source = "dictionary" };
        }

        var entry = await _context.WordLevels.AsNoTracking()
            .FirstOrDefaultAsync(wl => wl.Text == entryText, ct);

        return new GuestWordLookupDto
        {
            Word = word,
            MatchedForm = string.Equals(entryText, word, StringComparison.OrdinalIgnoreCase) ? null : entryText,
            CefrLevel = string.IsNullOrWhiteSpace(entry?.CefrLevel)
                ? null
                : entry.CefrLevel.Trim().ToUpperInvariant(),
            TranslationRu = string.IsNullOrWhiteSpace(entry?.TranslationRu) ? null : entry.TranslationRu,
            FreqRank = entry?.FreqRank > 0 ? entry.FreqRank : null,
            Source = "dictionary"
        };
    }

    /// <summary>
    /// Порядок форм для попытки: точное слово, усечённое до леммы, затем
    /// регулярные варианты LemmatizerService. Дубликаты и невалидные для
    /// справочника строки выбрасываются.
    /// </summary>
    private List<string> FormsToTry(string word, int budget)
    {
        var forms = new List<string>(budget);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Add(string? candidate)
        {
            if (forms.Count >= budget || string.IsNullOrWhiteSpace(candidate))
            {
                return;
            }

            var clean = candidate.Trim().ToLowerInvariant();
            if (clean.Length < 2 || !AllowedWord.IsMatch(clean))
            {
                return;
            }

            if (seen.Add(clean))
            {
                forms.Add(clean);
            }
        }

        Add(word);
        Add(_lemmatizer.Lemmatize(word));
        foreach (var form in _lemmatizer.GetForms(word))
        {
            Add(form);
        }

        return forms;
    }

    /// <summary>
    /// Нормализация входа: регистр, кавычки, пунктуация по краям, «don't»
    /// остаётся с апострофом. null — слово не годится для запроса.
    /// </summary>
    public static string? NormalizeInput(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        // Апостроф выводим кодом символа: в наборе Trim он один, а в виду
        // регулярного апострофа (прямой, типографский, обратный) нужен именно
        // прямой — остальные снимает AllowedWord.
        var apostrophe = (char)39;
        var clean = raw.Trim().ToLowerInvariant()
            .Trim(apostrophe, '"', '.', ',', '!', '?', ';', ':', '(', ')', '[', ']', '«', '»', '“', '”', '…', '—', '–');

        if (clean.Length < 2 || clean.Length > MaxWordLength || !AllowedWord.IsMatch(clean))
        {
            return null;
        }

        return clean;
    }
}
