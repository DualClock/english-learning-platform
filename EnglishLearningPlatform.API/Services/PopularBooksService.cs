using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

public class PopularBooksService
{
    // Прямой клиент БЕЗ прокси для OpenLibrary — доступен напрямую
    private static readonly HttpClient CoverHttpClient = new(new HttpClientHandler { UseProxy = false })
    {
        Timeout = TimeSpan.FromSeconds(10)
    };

    // Ключ открыт (был private): публичный каталог и его тесты должны уметь
    // прогреть список обложек, не отправляя ни одного запроса в Open Library.
    public const string PopularCoversCacheKey = "popular-covers";

    private static readonly TimeSpan CoversCacheTtl = TimeSpan.FromHours(24);

    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;
    private readonly IMemoryCache _cache;
    private readonly ILogger<PopularBooksService> _logger;

    public PopularBooksService(
        ApplicationDbContext context,
        IWebHostEnvironment environment,
        IMemoryCache cache,
        ILogger<PopularBooksService> logger)
    {
        _context = context;
        _environment = environment;
        _cache = cache;
        _logger = logger;
    }

    // 10 популярных книг на английском (public domain)
    private static readonly List<PopularBookInfo> PopularBooks = new()
    {
        new() {
            Title = "Pride and Prejudice",
            CefrLevel = "B2",
            Author = "Jane Austen",
            GutenbergId = "1342",
            Description = "Classic romance novel"
        },
        new() {
            Title = "Moby-Dick",
            CefrLevel = "C1",
            Author = "Herman Melville",
            GutenbergId = "2701",
            Description = "Adventure of Captain Ahab"
        },
        new() {
            Title = "Frankenstein",
            CefrLevel = "B1",
            Author = "Mary Shelley",
            GutenbergId = "84",
            Description = "Gothic science fiction"
        },
        new() {
            Title = "Dracula",
            CefrLevel = "B1",
            Author = "Bram Stoker",
            GutenbergId = "345",
            Description = "Classic horror novel"
        },
        new() {
            Title = "The Picture of Dorian Gray",
            CefrLevel = "B2",
            Author = "Oscar Wilde",
            GutenbergId = "174",
            Description = "Philosophical fiction"
        },
        new() {
            Title = "Jane Eyre",
            CefrLevel = "B2",
            Author = "Charlotte Brontë",
            GutenbergId = "1260",
            Description = "Gothic romance"
        },
        new() {
            Title = "Wuthering Heights",
            CefrLevel = "B2",
            Author = "Emily Brontë",
            GutenbergId = "768",
            Description = "Tragic love story"
        },
        new() {
            Title = "Great Expectations",
            CefrLevel = "B2",
            Author = "Charles Dickens",
            GutenbergId = "1400",
            Description = "Coming-of-age novel"
        },
        new() {
            Title = "The Adventures of Sherlock Holmes",
            CefrLevel = "B1",
            Author = "Arthur Conan Doyle",
            GutenbergId = "1661",
            Description = "Detective stories"
        },
        new() {
            Title = "Alice's Adventures in Wonderland",
            CefrLevel = "A2",
            Author = "Lewis Carroll",
            GutenbergId = "11",
            Description = "Fantasy adventure"
        }
    };

    public List<PopularBookInfo> GetPopularBooks()
    {
        return PopularBooks;
    }

    // Каталог для GET /api/books/popular: у всех книг заполнен CoverUrl.
    // Обложки берутся с Open Library (без привязки к книгам в БД), весь список
    // кэшируется на 24ч — повторные запросы отдаются мгновенно.
    public async Task<List<PopularBookInfo>> GetPopularBooksWithCoversAsync()
    {
        if (_cache.TryGetValue(PopularCoversCacheKey, out List<PopularBookInfo>? cached) &&
            cached != null)
        {
            return cached;
        }

        var result = PopularBooks.Select(b => new PopularBookInfo
        {
            Title = b.Title,
            Author = b.Author,
            GutenbergId = b.GutenbergId,
            Description = b.Description,
            CefrLevel = b.CefrLevel
        }).ToList();

        var withoutCover = result.Where(b => string.IsNullOrEmpty(b.CoverUrl)).ToList();
        if (withoutCover.Count > 0)
        {
            var covers = await Task.WhenAll(
                withoutCover.Select(b => GetCoverForAsync(b.Title, b.Author)));

            for (var i = 0; i < withoutCover.Count; i++)
            {
                withoutCover[i].CoverUrl = covers[i];
            }
        }

        _cache.Set(PopularCoversCacheKey, result, CoversCacheTtl);
        return result;
    }

    // Обложка из каталога (кэш popular-covers) — чтобы при добавлении книги
    // не ходить в Open Library второй раз
    public string? GetKnownCoverUrl(string gutenbergId)
    {
        if (_cache.TryGetValue(PopularCoversCacheKey, out List<PopularBookInfo>? cached) &&
            cached != null)
        {
            return cached.FirstOrDefault(b => b.GutenbergId == gutenbergId)?.CoverUrl;
        }

        return null;
    }

    public async Task<Book?> AddPopularBookAsync(string userId, string gutenbergId)
    {
        var bookInfo = PopularBooks.FirstOrDefault(b => b.GutenbergId == gutenbergId);
        if (bookInfo == null) return null;

        // Проверяем, есть ли уже у пользователя
        var existing = await _context.Books
            .FirstOrDefaultAsync(b => b.UploadedByUserId == userId &&
                                     b.Title == bookInfo.Title);

        if (existing != null)
        {
            // Обложку могли не найти при первом добавлении — сначала берём
            // уже известную из каталога, иначе идём в Open Library
            if (string.IsNullOrEmpty(existing.CoverUrl))
            {
                var known = GetKnownCoverUrl(gutenbergId);
                if (!string.IsNullOrEmpty(known))
                {
                    existing.CoverUrl = known;
                    await _context.SaveChangesAsync();
                }
                else
                {
                    await TrySetCoverUrlAsync(existing);
                }
            }

            return existing;
        }

        // Скачиваем книгу с Project Gutenberg
        var epubUrl = $"https://www.gutenberg.org/ebooks/{gutenbergId}.epub3.images";

        try
        {
            using var httpClient = new HttpClient();
            var epubBytes = await httpClient.GetByteArrayAsync(epubUrl);

            // Сохраняем файл
            var uploadsFolder = Path.Combine(_environment.ContentRootPath, "uploads", "books");
            Directory.CreateDirectory(uploadsFolder);

            var fileName = $"{Guid.NewGuid()}.epub";
            var filePath = Path.Combine(uploadsFolder, fileName);

            await File.WriteAllBytesAsync(filePath, epubBytes);

            // Сохраняем в базу
            var book = new Book
            {
                Title = bookInfo.Title,
                Author = bookInfo.Author,
                Language = "en",
                Description = bookInfo.Description,
                CefrLevel = bookInfo.CefrLevel,
                FilePath = fileName,
                FileSize = epubBytes.Length,
                // Обложка уже известна из каталога — второй запрос к Open Library не нужен
                CoverUrl = GetKnownCoverUrl(gutenbergId),
                UploadedByUserId = userId
            };

            _context.Books.Add(book);
            await _context.SaveChangesAsync();

            await TrySetCoverUrlAsync(book);

            return book;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to download book {GutenbergId}", gutenbergId);
            return null;
        }
    }

    // Ищем обложку на OpenLibrary по названию и автору и присваиваем книге.
    // При любой ошибке просто пропускаем — фронт покажет заглушку.
    public async Task TrySetCoverUrlAsync(Book book)
    {
        if (!string.IsNullOrEmpty(book.CoverUrl)) return;

        var coverUrl = await GetCoverForAsync(book.Title, book.Author);
        if (coverUrl != null)
        {
            book.CoverUrl = coverUrl;
            await _context.SaveChangesAsync();
        }
    }

    // Поиск обложки на Open Library по названию и автору. Ничего не пишет в БД —
    // используется и для каталога, и для книг пользователя. Timeout 8с.
    public async Task<string?> GetCoverForAsync(string title, string? author)
    {
        try
        {
            var query = Uri.EscapeDataString($"{title} {author}".Trim());
            var url = $"https://openlibrary.org/search.json?q={query}&fields=cover_i&limit=1";

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var response = await CoverHttpClient.GetAsync(url, cts.Token);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("OpenLibrary cover search returned {Status} for {Title}",
                    response.StatusCode, title);
                return null;
            }

            var json = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (root.TryGetProperty("docs", out var docs) &&
                docs.ValueKind == JsonValueKind.Array &&
                docs.GetArrayLength() > 0 &&
                docs[0].TryGetProperty("cover_i", out var cover) &&
                cover.TryGetInt32(out var coverId))
            {
                return $"https://covers.openlibrary.org/b/id/{coverId}-M.jpg";
            }

            return null;
        }
        catch (Exception ex)
        {
            // Обложка не критична — молча пропускаем
            _logger.LogWarning(ex, "Failed to fetch cover for {Title}", title);
            return null;
        }
    }
}

public class PopularBookInfo
{
    public string Title { get; set; } = string.Empty;
    public string Author { get; set; } = string.Empty;
    public string GutenbergId { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? CefrLevel { get; set; }
    public string? CoverUrl { get; set; }
}