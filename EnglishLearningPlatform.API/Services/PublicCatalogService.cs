using System.Text;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Анонимный read-слой публичной витрины (/library). В БД ничего не пишет и
/// ничего не меняет.
///
/// ПРИВАТНОСТЬ — главное ограничение этого класса.
///
/// В Books нет ни одной «общей» копии книг: и классика (POST /api/books/popular),
/// и рассказы (POST /api/books/story) создаются как экземпляры конкретного
/// пользователя, то есть у каждой строки таблицы заполнен UploadedByUserId.
/// Поэтому каталог собирается из двух источников, и ни один из них не может
/// показать чужую книгу:
///
///  1. Сидах-в-коде: список классики в PopularBooksService и градированные
///     рассказы в Data/Seed/stories.json. Это тексты, которые мы сами кладём в
///     репозиторий как public domain; строк таблицы Books они не касаются.
///  2. Строках Books, у которых UploadedByUserId == null. Сегодня таких нет;
///     фильтр нужен, чтобы завтра системная копия, которую заведёт админ-сидер,
///     появилась на витрине без ручной правки этого класса. Пустая строка
///     системной НЕ считается: формулировка «null» взята из постановки задачи
///     буквально, и это строже, чем FilesController.cs:105, где отсутствие
///     владельца трактуется как «публично». Лишняя строка в каталоге стоит
///     чужого EPUB, поэтому выбираем консервативный вариант.
///
/// Чужой EPUB, который пользователь загрузил сам, в каталог не попадает ни
/// одним путём: приватные строки не читаются даже для совпадения по названию.
/// Проверено тестом PublicCatalogPrivacyTests.
///
/// МАСШТАБ. Резолв слага — линейный проход по собранному каталогу (~18 записей
/// сегодня). Это осознанный выбор: каталог целиком лежит в IMemoryCache, и
/// O(n) по 18 строкам дешевле, чем index на таблице, которую мы не читаем.
/// Что делать при росте: если публичных книг станет сотни — держать в кэше
/// Dictionary(slug → запись) вместо списка; интерфейс контроллера при этом не
/// меняется. Коллизии заголовков уже закрыты: одинаковые слагги получают суффикс
/// -2/-3 (см. PublicSlug.AssignSlugs), так что разные книги не спорят за один URL.
/// </summary>
public class PublicCatalogService
{
    /// <summary>
    /// Жёсткий потолок превью в словах. Юридическая граница: витрина показывает
    /// «первые строки», а не главу целиком и тем более не книгу — 150 слов это
    /// один абзац для рассказа и меньше 0,2% для романа.
    /// </summary>
    public const int PreviewWordLimit = 150;

    private static readonly TimeSpan CatalogCacheTtl = TimeSpan.FromHours(6);
    private static readonly TimeSpan PreviewCacheTtl = TimeSpan.FromHours(12);

    /// <summary>Размер «страницы» при чтении EPUB ради превью — как в читалке.</summary>
    private const int PreviewPageSize = 300;

    /// <summary>
    /// EPUB больше этого размера ради превью не разбираем. BookService читает
    /// книгу целиком, и без предохранителя один запрос краулера заставлял бы
    /// сервер распаковывать и склеивать 50-мегабайтный архив.
    /// </summary>
    private const long MaxPreviewFileBytes = 15L * 1024 * 1024;

    /// <summary>
    /// Сколько миллисекунд публичный эндпоинт готов ждать обложки с Open Library.
    /// PopularBooksService ходит в сеть (по 8 с на книгу), а краулер не должен
    /// платить за это TTFB: не успели — отдаём витрину без обложек, а фоновый
    /// запрос доходит до конца и заполняет кэш обложек к следующей сборке.
    /// </summary>
    private static readonly TimeSpan CoverBudget = TimeSpan.FromSeconds(3);

    // Ключи открыты: тесты проверяют, что каталог и превью переиспользуются, а
    // не пересобираются на каждый запрос краулера.
    public const string CatalogCacheKey = "public-catalog";
    public const string PreviewCacheKeyPrefix = "public-catalog-preview:";

    // Одна пересборка каталога на весь процесс: краулер, пришедший первым, не
    // должен запускать десять параллельных сборок.
    private static readonly SemaphoreSlim BuildLock = new(1, 1);

    private readonly ApplicationDbContext _context;
    private readonly StorySeeder _storySeeder;
    private readonly PopularBooksService _popularBooksService;
    private readonly BookService _bookService;
    private readonly IMemoryCache _cache;
    private readonly ILogger<PublicCatalogService> _logger;

    public PublicCatalogService(
        ApplicationDbContext context,
        StorySeeder storySeeder,
        PopularBooksService popularBooksService,
        BookService bookService,
        IMemoryCache cache,
        ILogger<PublicCatalogService> logger)
    {
        _context = context;
        _storySeeder = storySeeder;
        _popularBooksService = popularBooksService;
        _bookService = bookService;
        _cache = cache;
        _logger = logger;
    }

    /// <summary>Весь публичный каталог: отсортированный, со слагами и превью.</summary>
    public async Task<IReadOnlyList<PublicBookDto>> GetCatalogAsync(CancellationToken ct = default)
    {
        if (_cache.TryGetValue(CatalogCacheKey, out IReadOnlyList<PublicBookDto>? cached) &&
            cached != null)
        {
            return cached;
        }

        await BuildLock.WaitAsync(ct);
        try
        {
            // Двойная проверка: пока ждали семафор, каталог мог собрать кто-то другой
            if (_cache.TryGetValue(CatalogCacheKey, out cached) && cached != null)
            {
                return cached;
            }

            var built = await BuildAsync(ct);
            _cache.Set(CatalogCacheKey, built, CatalogCacheTtl);
            return built;
        }
        finally
        {
            BuildLock.Release();
        }
    }

    /// <summary>
    /// Поиск книги по публичному слагу. Регистр и завершающий слэш не важны:
    /// адрес человек может скопировать из мессенджера.
    ///
    /// Линейный проход по каталогу из кэша — см. комментарий класса про масштаб.
    /// </summary>
    public async Task<PublicBookDto?> FindAsync(string slug, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(slug)) return null;

        var wanted = slug.Trim().TrimEnd('/');
        var catalog = await GetCatalogAsync(ct);

        return catalog.FirstOrDefault(b =>
            string.Equals(b.Slug, wanted, StringComparison.OrdinalIgnoreCase));
    }

    // ------------------------------------------------------------------ сборка

    private async Task<IReadOnlyList<PublicBookDto>> BuildAsync(CancellationToken ct)
    {
        var stories = _storySeeder.GetStories();
        var systemBooks = await GetSystemBooksAsync(ct);
        var classics = await GetClassicsAsync();

        var entries = new List<CatalogEntry>();

        // 1. Градированные рассказы. Текст лежит в сидах (Data/Seed/stories.json),
        //    написан нами и является public domain по определению, поэтому
        //    превью берётся оттуда — без чтения чужих EPUB.
        for (var i = 0; i < stories.Count; i++)
        {
            var story = stories[i];
            if (string.IsNullOrWhiteSpace(story.Title)) continue;

            var text = string.Join(" ", story.Paragraphs);

            entries.Add(new CatalogEntry(
                Title: story.Title,
                Author: story.Author,
                CefrLevel: story.CefrLevel,
                Kind: CatalogKinds.Story,
                Description: story.Description,
                WordCount: CountWords(text),
                CoverUrl: SafeStoryCover(i, story),
                GutenbergId: null,
                SeedText: text,
                BookId: null));
        }

        // 2. Классика из Gutenberg. Строки таблицы Books для этих названий берём
        //    только из whitelist'а (UploadedByUserId == null): совпало название —
        //    значит у нас есть системная копия, из неё и объём, и превью.
        var claimedSystemIds = new HashSet<int>();

        foreach (var classic in classics)
        {
            if (string.IsNullOrWhiteSpace(classic.Title)) continue;

            var match = systemBooks.FirstOrDefault(b =>
                string.Equals(b.Title, classic.Title, StringComparison.OrdinalIgnoreCase));

            if (match != null) claimedSystemIds.Add(match.Id);

            entries.Add(new CatalogEntry(
                Title: classic.Title,
                Author: classic.Author,
                CefrLevel: classic.CefrLevel,
                Kind: CatalogKinds.Classic,
                Description: classic.Description,
                WordCount: match?.WordCount > 0 ? match!.WordCount : null,
                CoverUrl: classic.CoverUrl ?? match?.CoverUrl,
                GutenbergId: classic.GutenbergId,
                SeedText: null,
                BookId: match?.Id));
        }

        // 3. Системные строки Books, которым не нашлось места в сидах (например,
        //    админ-сидер добавит новую public domain книгу). Приватные строки
        //    сюда не доходят: GetSystemBooksAsync фильтрует на уровне SQL.
        foreach (var book in systemBooks.Where(b => !claimedSystemIds.Contains(b.Id)))
        {
            entries.Add(new CatalogEntry(
                Title: book.Title,
                Author: book.Author,
                CefrLevel: book.CefrLevel,
                Kind: CatalogKinds.Classic,
                Description: book.Description,
                WordCount: book.WordCount > 0 ? book.WordCount : null,
                CoverUrl: book.CoverUrl,
                GutenbergId: null,
                SeedText: null,
                BookId: book.Id));
        }

        // Детерминированный порядок = детерминированные слагги: суффикс коллизии
        // достаётся той же книге после перезапуска процесса и после деплоя.
        var ordered = entries
            .OrderBy(e => PublicSlug.LevelOrder(e.CefrLevel))
            .ThenBy(e => e.Title, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.Kind, StringComparer.Ordinal)
            .ThenBy(e => e.BookId ?? -1)
            .ToList();

        var slugs = PublicSlug.AssignSlugs(ordered.Select(e => e.Title));

        var result = new List<PublicBookDto>(ordered.Count);
        for (var i = 0; i < ordered.Count; i++)
        {
            var entry = ordered[i];
            var preview = await ResolvePreviewAsync(entry, ct);

            result.Add(new PublicBookDto(
                Slug: slugs[i],
                Title: entry.Title,
                Author: entry.Author,
                CefrLevel: NormalizeLevel(entry.CefrLevel),
                Kind: entry.Kind,
                Description: string.IsNullOrWhiteSpace(entry.Description) ? null : entry.Description,
                WordCount: entry.WordCount,
                CoverUrl: entry.CoverUrl,
                GutenbergId: entry.GutenbergId,
                Preview: preview));
        }

        _logger.LogInformation("Публичный каталог собран: {Count} книг", result.Count);
        return result;
    }

    // --------------------------------------------------------------- источники

    /// <summary>
    /// Строки Books без владельца. Фильтр стоит в запросе, а не в памяти:
    /// приватные названия не должны попадать даже в tracker контекста.
    /// </summary>
    private async Task<List<Book>> GetSystemBooksAsync(CancellationToken ct) =>
        await _context.Books.AsNoTracking()
            .Where(b => b.UploadedByUserId == null)
            .OrderBy(b => b.Id)
            .ToListAsync(ct);

    /// <summary>
    /// Классика из сида PopularBooksService. Обложки там ищутся в Open Library,
    /// а публичная страница не должна ждать сеть на каждом холодном кэше: ждём
    /// не больше <see cref="CoverBudget"/>, иначе отдаём список без обложек, а
    /// запрос доходит до конца в фоне и наполнит кэш к следующей сборке.
    /// </summary>
    private async Task<List<PopularBookInfo>> GetClassicsAsync()
    {
        var coversTask = _popularBooksService.GetPopularBooksWithCoversAsync();
        var finished = await Task.WhenAny(coversTask, Task.Delay(CoverBudget));

        if (finished == coversTask)
        {
            try
            {
                return await coversTask;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Каталог обложек недоступен, отдаём классики без обложек");
            }
        }
        else
        {
            // Задачу не бросаем без наблюдения: она доделает запросы и наполнит
            // кэш popular-covers. ContinueWith лишь вычитывает исключение.
            _ = coversTask.ContinueWith(
                static t => _ = t.Exception,
                TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);

            _logger.LogInformation(
                "Обложки не успели за {Budget}, отдаём каталог без части обложек", CoverBudget);
        }

        // Обложки из уже прогретого кэша подставляем и здесь — это локальная
        // операция. Копируем записи, а не правим PopularBooksService.PopularBooks:
        // это статический сид, его mutation из запроса был бы гонкой между потоками.
        return _popularBooksService.GetPopularBooks()
            .Select(b => new PopularBookInfo
            {
                Title = b.Title,
                Author = b.Author,
                GutenbergId = b.GutenbergId,
                Description = b.Description,
                CefrLevel = b.CefrLevel,
                CoverUrl = _popularBooksService.GetKnownCoverUrl(b.GutenbergId)
            })
            .ToList();
    }

    private string? SafeStoryCover(int index, StorySeedData story)
    {
        try
        {
            return _storySeeder.EnsureCoverUrl(index, story);
        }
        catch (Exception ex)
        {
            // Обложка не критична: без неё страница остаётся валидной витриной
            _logger.LogWarning(ex, "Не удалось подготовить обложку рассказа {Title}", story.Title);
            return null;
        }
    }

    // ------------------------------------------------------------------ превью

    /// <summary>
    /// Превью витрины. Источник — ТОЛЬКО public domain:
    ///
    ///  1. абзацы рассказа из сида Data/Seed/stories.json (текст лежит в
    ///     репозитории, написан нами);
    ///  2. первая страница EPUB системной копии (строка Books без владельца) —
    ///     через существующий механизм чтения BookService/EpubReader.
    ///
    /// Второе — это и есть юридическая граница: приватный EPUB пользователя не
    /// читается даже тогда, когда книга совпала по названию с классикой из
    /// Gutenberg. Проверка whitelist стоит повторно на уровне SQL прямо перед
    /// чтением файла, а не только при сборке списка: защита от того, что кто-то
    /// передаст в метод чужой bookId.
    ///
    /// Цена: распаковка EPUB — самая дорогая операция на этом пути, поэтому
    /// результат закеширован (12 ч) и ограничен размером файла. Публичная
    /// страница не должна превращаться в «каждый краулер распаковывает Моби Дик».
    /// </summary>
    private async Task<string?> ResolvePreviewAsync(CatalogEntry entry, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(entry.SeedText))
        {
            return TakePreview(entry.SeedText);
        }

        if (entry.BookId is not { } bookId) return null;

        var cacheKey = PreviewCacheKeyPrefix + bookId;
        if (_cache.TryGetValue(cacheKey, out string? cachedPreview))
        {
            // Отрицательный результат тоже кэш: отсутствие файла или слишком
            // большой архив не надо перебирать на каждый запрос краулера
            return cachedPreview;
        }

        var preview = await BuildPreviewFromEpubAsync(bookId, ct);
        _cache.Set(cacheKey, preview, PreviewCacheTtl);
        return preview;
    }

    private async Task<string?> BuildPreviewFromEpubAsync(int bookId, CancellationToken ct)
    {
        var allowed = await _context.Books.AsNoTracking()
            .Where(b => b.Id == bookId && b.UploadedByUserId == null)
            .Select(b => new { b.FilePath, b.FileSize })
            .FirstOrDefaultAsync(ct);

        if (allowed == null)
        {
            _logger.LogWarning("Превью запрошено для книги {BookId}, у которой есть владелец", bookId);
            return null;
        }

        if (allowed.FileSize > MaxPreviewFileBytes)
        {
            _logger.LogInformation(
                "Превью книги {BookId} не строится: файл {Size} байт больше лимита",
                bookId, allowed.FileSize);
            return null;
        }

        var pages = await _bookService.GetPagesAsync(bookId, PreviewPageSize);
        if (pages == null || pages.Count == 0) return null;

        return TakePreview(pages[0]);
    }

    /// <summary>
    /// Первые <see cref="PreviewWordLimit"/> слов, обрезанные по границе
    /// предложения, с многоточием на месте разрыва. Дольше — уже не витрина.
    /// </summary>
    public static string TakePreview(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;

        var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (words.Length == 0) return string.Empty;

        var take = Math.Min(words.Length, PreviewWordLimit);
        var preview = string.Join(' ', words.Take(take));

        // Режем по последнему знаку конца предложения: обрывок «and the ear»
        // читается как ошибка, а «…and the winter.» — как цитата. Границу ищем
        // не дальше хвоста, иначе превью схлопнется до пары слов.
        if (take < words.Length)
        {
            var start = Math.Max(0, preview.Length - PreviewSentenceTail);
            var boundary = preview.LastIndexOfAny(SentenceEnds, preview.Length - 1);

            preview = boundary >= start ? preview[..(boundary + 1)] : preview.TrimEnd();
            preview += "…";
        }

        return preview.Trim();
    }

    private static readonly char[] SentenceEnds = ['.', '!', '?', '…'];

    // Сколько символов с конца мы вообще смотрим в поисках конца предложения
    private const int PreviewSentenceTail = 320;

    private static int? CountWords(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        return text.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
    }

    private static string? NormalizeLevel(string? level) =>
        string.IsNullOrWhiteSpace(level) ? null : level.Trim().ToUpperInvariant();

    /// <summary>Промежуточная запись каталога: до присвоения слагов и превью.</summary>
    private sealed record CatalogEntry(
        string Title,
        string? Author,
        string? CefrLevel,
        string Kind,
        string? Description,
        int? WordCount,
        string? CoverUrl,
        string? GutenbergId,
        string? SeedText,
        int? BookId);
}

public static class CatalogKinds
{
    public const string Classic = "classic";
    public const string Story = "story";
}
