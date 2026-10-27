using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services.Guest;

/// <summary>
/// Каталог гостевого чтения: какие книги можно открыть без аккаунта и что
/// именно из них видно.
///
/// ПРИВАТНОСТЬ — то же ограничение, что у PublicCatalogService, и та же
/// причина: существующие сервисы читалки проверяют владельца
/// (<c>BookService.GetBookAsync</c> сравнивает <c>UploadedByUserId</c> с userId),
/// поэтому для сидовой классики они возвращают null, а ослаблять эту проверку
/// ради гостя нельзя — она охраняет чужие EPUB. Здесь свой, узкий слой:
///
///  1. Список книг — только строки Books с <c>UploadedByUserId == null</c>.
///     Фильтр стоит в SQL, а не в памяти: приватные строки не попадают даже
///     в материал для выбора.
///  2. Слаг — тот же, что у /library (<see cref="PublicSlug"/>): гость
///     приходит с витрины, и /reader/preview/&lt;slug&gt; обязан совпадать с
///     /library/&lt;slug&gt;. Слаги считаются по тому же порядку сортировки,
///     что в PublicCatalogService, поэтому суффиксы коллизий совпадают.
///  3. Глава — только первая. Не «первая из запрошенных», а ровно
///     Chapters[0] снапшота; выбор другой главы — 403 на уровне контроллера.
///
/// В БД этот класс не пишет НИЧЕГО. Единственная запись, которую он может
/// вызвать, — первичный разбор EPUB в ReaderContentService (кэш снапшота,
/// общий со всеми копиями книги); она не создаёт пользовательских строк и
/// выполняется один раз на файл, а не на гостя.
/// </summary>
public class GuestReaderCatalog
{
    /// <summary>Список каталога меняется так же редко, как публичная витрина.</summary>
    private static readonly TimeSpan CatalogCacheTtl = TimeSpan.FromHours(6);

    // Ключи открыты: тест проверяет, что второй запрос гостя не пересобирает
    // каталог и не распаковывает EPUB заново.
    public const string CatalogCacheKey = "guest-reader:catalog";

    private readonly ApplicationDbContext _context;
    private readonly ReaderContentService _content;
    private readonly IMemoryCache _cache;
    private readonly GuestPreviewOptions _options;

    public GuestReaderCatalog(
        ApplicationDbContext context,
        ReaderContentService content,
        IMemoryCache cache,
        GuestPreviewOptions? options = null)
    {
        _context = context;
        _content = content;
        _cache = cache;
        // Опции приходят из конфигурации; без регистрации секции берём
        // значения по умолчанию — гостевое чтение не должно падать из-за
        // отсутствующего appsettings-ключа.
        _options = options ?? new GuestPreviewOptions();
    }

    /// <summary>Все книги, которые гость может открыть. Только чтение.</summary>
    public async Task<IReadOnlyList<GuestBookSummaryDto>> GetBooksAsync(CancellationToken ct = default)
    {
        if (_cache.TryGetValue(CatalogCacheKey, out IReadOnlyList<GuestBookSummaryDto>? cached) && cached != null)
        {
            return cached;
        }

        var books = await ListGuestBooksAsync(ct);

        // Снапшот нужен ради числа глав. Он кэшируется внутри
        // ReaderContentService, поэтому распаковка EPUB происходит один раз на
        // файл, а не на каждый запрос каталога.
        var result = new List<GuestBookSummaryDto>(books.Count);
        foreach (var row in books)
        {
            var snapshot = await _content.EnsureSnapshotAsync(row.Book, ct);
            result.Add(new GuestBookSummaryDto
            {
                Slug = row.Slug,
                Title = row.Book.Title,
                Author = row.Book.Author,
                CefrLevel = NormalizeLevel(row.Book.CefrLevel),
                ChapterCount = snapshot?.Chapters.Count
            });
        }

        _cache.Set(CatalogCacheKey, (IReadOnlyList<GuestBookSummaryDto>)result, CatalogCacheTtl);
        return result;
    }

    /// <summary>
    /// Манифест книги по слагу: что за книга, сколько глав и первая глава.
    /// null — книги нет в гостеприимном каталоге (в том числе если она
    /// загружена пользователем).
    /// </summary>
    public async Task<GuestBookManifestDto?> GetManifestAsync(string slug, CancellationToken ct = default)
    {
        var book = await FindAsync(slug, ct);
        if (book == null)
        {
            return null;
        }

        var snapshot = await _content.EnsureSnapshotAsync(book.Book, ct);
        var first = snapshot?.Chapters.FirstOrDefault();

        return new GuestBookManifestDto
        {
            Slug = book.Slug,
            Title = book.Book.Title,
            Author = book.Book.Author,
            CefrLevel = NormalizeLevel(book.Book.CefrLevel),
            Description = string.IsNullOrWhiteSpace(book.Book.Description) ? null : book.Book.Description,
            CoverUrl = book.Book.CoverUrl,
            HasText = first != null,
            ChapterCount = snapshot?.Chapters.Count ?? 0,
            WordCount = snapshot?.WordCount ?? book.Book.WordCount,
            Chapters = first == null
                ? new List<GuestChapterLinkDto>()
                : new List<GuestChapterLinkDto>
                {
                    new()
                    {
                        Id = first.Id,
                        Title = first.Title,
                        Index = 0,
                        WordCount = first.WordCount
                    }
                },
            ChaptersAvailableToGuest = first == null ? null : 1
        };
    }

    /// <summary>
    /// Первая глава книги. Возвращает null, если книги нет. Для любой
    /// ненулевой позиции главы — <see cref="GuestChapterAccess.OtherChapter"/>:
    /// текст чужой главы не сериализуется вовсе, а не «отдаётся и потом
    /// прячется на клиенте».
    /// </summary>
    public async Task<(GuestChapterAccess Access, GuestChapterDto? Chapter)> GetChapterAsync(
        string slug,
        string? chapterId,
        CancellationToken ct = default)
    {
        var book = await FindAsync(slug, ct);
        if (book == null)
        {
            return (GuestChapterAccess.BookNotFound, null);
        }

        var snapshot = await _content.EnsureSnapshotAsync(book.Book, ct);
        var first = snapshot?.Chapters.FirstOrDefault();
        if (first == null)
        {
            return (GuestChapterAccess.NoText, null);
        }

        // Пустой chapterId — «дай ту, что открыта», это же адрес по умолчанию
        // для страницы превью. Любой другой id — отказ, даже если это
        // существующая глава: гость видит ровно одну.
        if (!string.IsNullOrWhiteSpace(chapterId) &&
            !string.Equals(chapterId.Trim(), first.Id, StringComparison.Ordinal))
        {
            return (GuestChapterAccess.OtherChapter, null);
        }

        var blocks = first.Blocks
            .Take(Math.Max(1, _options.MaxBlocksPerChapter))
            .Select(block => new ReaderBlockDto
            {
                Id = block.Id,
                Type = block.Type,
                Sentences = block.Sentences.Select(s => new ReaderSentenceDto
                {
                    Id = s.Id,
                    Text = s.Text,
                    WordStart = s.WordStart,
                    WordCount = s.WordCount
                }).ToList(),
                // Гостю ссылки на картинки не строим: подписанный URL — это
                // приватный адрес файла в хранилище, а публичная превью-страница
                // обходится текстом. Block.Asset остаётся, чтобы фронт не
                // выглядел пустым местом там, где в книге картинка.
                Alt = block.Alt,
                Caption = block.Caption,
                Width = block.Width,
                Height = block.Height
            })
            .ToList();

        return (GuestChapterAccess.Granted, new GuestChapterDto
        {
            BookSlug = book.Slug,
            BookTitle = book.Book.Title,
            Id = first.Id,
            Title = first.Title,
            Index = 0,
            TotalChapters = snapshot!.Chapters.Count,
            WordStart = first.WordStart,
            WordCount = first.WordCount,
            Blocks = blocks,
            IsPreview = true,
            Truncated = first.Blocks.Count > blocks.Count
        });
    }

    /// <summary>Есть ли слаг в гостеприимном каталоге. Дешёвая проверка для лимитов и 404.</summary>
    public async Task<bool> ExistsAsync(string slug, CancellationToken ct = default)
    {
        var found = await FindAsync(slug, ct);
        return found != null;
    }

    // ------------------------------------------------------------------ поиск

    /// <summary>Строка Books без владельца + её публичный слаг.</summary>
    private sealed record GuestBookRow(string Slug, Models.Book Book);

    private async Task<GuestBookRow?> FindAsync(string slug, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(slug))
        {
            return null;
        }

        var wanted = slug.Trim().TrimEnd('/');
        var books = await ListGuestBooksAsync(ct);

        // Регистр не важен: адрес книги люди копируют руками из мессенджера.
        return books.FirstOrDefault(b =>
            string.Equals(b.Slug, wanted, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<List<GuestBookRow>> ListGuestBooksAsync(CancellationToken ct)
    {
        // Фильтр в SQL: приватная строка не должна дойти до памяти даже
        // затем, чтобы быть отброшенной.
        var system = await _context.Books.AsNoTracking()
            .Where(b => b.UploadedByUserId == null)
            .OrderBy(b => b.Id)
            .ToListAsync(ct);

        // Порядок — как у сборки публичного каталога: уровень, название, id.
        // Без этого суффиксы коллизий в слагах разъедутся с /library, и один и
        // тот же slug будет указывать на разные книги на двух страницах.
        var ordered = system
            .OrderBy(b => PublicSlug.LevelOrder(b.CefrLevel))
            .ThenBy(b => b.Title, StringComparer.OrdinalIgnoreCase)
            .ThenBy(b => b.Id)
            .ToList();

        var slugs = PublicSlug.AssignSlugs(ordered.Select(b => b.Title));

        var result = new List<GuestBookRow>(ordered.Count);
        for (var i = 0; i < ordered.Count; i++)
        {
            result.Add(new GuestBookRow(slugs[i], ordered[i]));
        }

        // Сидовая классика, у которой системной копии в Books нет, тоже живёт
        // на витрине. Приписать ей слаг без файла нельзя — чтение такой книги
        // уйдёт в HasText = false. Поэтому в каталог гостя она не попадает, но
        // резолв слага её знает: страница превью отдаст честное «текста нет»,
        // а не 404, если ссылка пришла из старого поста.
        return result;
    }

    private static string? NormalizeLevel(string? level) =>
        string.IsNullOrWhiteSpace(level) ? null : level.Trim().ToUpperInvariant();
}

/// <summary>Исход попытки получить главу: контроллер превращает его в 200/403/404.</summary>
public enum GuestChapterAccess
{
    Granted,
    BookNotFound,
    NoText,
    OtherChapter
}
