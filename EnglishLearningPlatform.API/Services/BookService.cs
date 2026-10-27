using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using VersOne.Epub;

namespace EnglishLearningPlatform.API.Services;

public class BookService
{
    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<BookService> _logger;
    private readonly IMemoryCache _cache;

    private static readonly TimeSpan PagesCacheTtl = TimeSpan.FromHours(1);

    private const long MaxUploadBytes = 50 * 1024 * 1024;

    // Защита от zip-бомб: сжатый архив ≤ 50 МБ может развернуться в гигабайты.
    // Ограничиваем заявленный распакованный объём и число записей до чтения EPUB.
    private const long MaxExpandedBytes = 150L * 1024 * 1024;
    private const long MaxSingleEntryBytes = 50L * 1024 * 1024;
    private const int MaxArchiveEntries = 5000;

    // Полный текст книги — десятки мегабайт. Кэшируем только книги в рамках
    // бюджета: иначе несколько больших EPUB вытеснят память инстанса.
    public const int MaxCachedTextChars = 2_000_000;

    public static bool ShouldCacheText(long totalChars) => totalChars <= MaxCachedTextChars;

    public BookService(
        ApplicationDbContext context,
        IWebHostEnvironment environment,
        ILogger<BookService> logger,
        IMemoryCache cache)
    {
        _context = context;
        _environment = environment;
        _logger = logger;
        _cache = cache;
    }

    public async Task<Book?> UploadBookAsync(string userId, IFormFile file)
    {
        if (file.Length == 0)
            return null;

        // Защита от гигантских загрузок: EPUB больше 50 МБ не принимаем
        if (file.Length > MaxUploadBytes)
            return null;

        var extension = Path.GetExtension(file.FileName).ToLower();
        if (extension != ".epub")
            return null;

        // Проверяем архив до записи на диск и до EpubReader: «бомба» с
        // заявленным распакованным объёмом в гигабайты отклоняется сразу.
        await using (var validationStream = file.OpenReadStream())
        {
            if (!IsArchiveWithinLimits(validationStream, MaxSingleEntryBytes, MaxExpandedBytes, MaxArchiveEntries))
            {
                _logger.LogWarning(
                    "EPUB upload rejected: archive exceeds safe expansion limits (file {FileName}, {Size} bytes)",
                    file.FileName, file.Length);
                return null;
            }
        }

        var uploadsFolder = Path.Combine(_environment.ContentRootPath, "uploads", "books");
        Directory.CreateDirectory(uploadsFolder);

        var coversFolder = Path.Combine(_environment.ContentRootPath, "uploads", "covers");
        Directory.CreateDirectory(coversFolder);

        var fileName = $"{Guid.NewGuid()}{extension}";
        var filePath = Path.Combine(uploadsFolder, fileName);

        using (var stream = new FileStream(filePath, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }

        string? title = null;
        string? author = null;
        string? language = null;
        string? coverUrl = null;

        try
        {
            var book = await EpubReader.ReadBookAsync(filePath);
            title = book.Title;
            author = book.Author;
            language = book.Schema.Package.Metadata.Languages?.FirstOrDefault()?.Language;

            // Извлекаем обложку
            var coverImage = book.CoverImage;
            if (coverImage != null)
            {
                var coverFileName = $"{Guid.NewGuid()}.jpg";
                var coverFilePath = Path.Combine(coversFolder, coverFileName);

                await File.WriteAllBytesAsync(coverFilePath, coverImage);
                coverUrl = $"/uploads/covers/{coverFileName}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read EPUB metadata");
            title = Path.GetFileNameWithoutExtension(file.FileName);
        }

        var newBook = new Book
        {
            Title = title ?? Path.GetFileNameWithoutExtension(file.FileName),
            Author = author,
            Language = language ?? "en",
            FilePath = fileName,
            FileSize = file.Length,
            CoverUrl = coverUrl,
            UploadedByUserId = userId
        };

        _context.Books.Add(newBook);
        await _context.SaveChangesAsync();

        return newBook;
    }

    /// <summary>
    /// Проверяет, что zip-архив не развернётся за пределы лимитов.
    /// Смотрит заявленные размеры записей в центральном каталоге и не
    /// распаковывает данные, поэтому дешёв для больших «бомб».
    /// </summary>
    public static bool IsArchiveWithinLimits(Stream stream, long maxEntryBytes, long maxTotalBytes, int maxEntries)
    {
        try
        {
            using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
            if (archive.Entries.Count > maxEntries)
            {
                return false;
            }

            long totalLength = 0;
            foreach (var entry in archive.Entries)
            {
                if (entry.Length > maxEntryBytes)
                {
                    return false;
                }

                totalLength += entry.Length;
                if (totalLength > maxTotalBytes)
                {
                    return false;
                }
            }

            return true;
        }
        catch (InvalidDataException)
        {
            // Не zip — это не EPUB
            return false;
        }
    }

    public async Task<(List<Book> Items, int TotalCount)> GetUserBooksAsync(string userId, int page, int pageSize)
    {
        var query = _context.Books
            .Where(b => b.UploadedByUserId == userId)
            .OrderByDescending(b => b.CreatedAt);

        var totalCount = await query.CountAsync();

        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return (items, totalCount);
    }

    public async Task<Book?> GetBookAsync(string userId, int bookId)
    {
        return await _context.Books
            .FirstOrDefaultAsync(b => b.Id == bookId && b.UploadedByUserId == userId);
    }

    // Полный текст книги, разбитый на страницы ~300 слов, с кэшем:
    // EPUB больше не перечитывается на каждый запрос страницы
    public async Task<List<string>?> GetPagesAsync(int bookId, int pageSize = 300)
    {
        var cacheKey = $"bookpages:{bookId}:{pageSize}";
        if (_cache.TryGetValue(cacheKey, out List<string>? cached) && cached != null)
        {
            return cached;
        }

        var book = await _context.Books.AsNoTracking()
            .FirstOrDefaultAsync(b => b.Id == bookId);
        if (book == null) return null;

        var filePath = Path.Combine(_environment.ContentRootPath, "uploads", "books", book.FilePath);
        if (!File.Exists(filePath)) return null;

        try
        {
            var epubBook = await EpubReader.ReadBookAsync(filePath);
            var fullText = new StringBuilder();

            foreach (var chapter in epubBook.ReadingOrder)
            {
                var text = CleanHtml(chapter.Content);
                if (!string.IsNullOrWhiteSpace(text))
                {
                    fullText.AppendLine(text);
                }
            }

            var pages = StripGutenbergFrontMatter(fullText.ToString())
                .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Chunk(pageSize)
                .Select(c => string.Join(" ", c))
                .ToList();

            if (pages.Count == 0) pages.Add(string.Empty);

            // Большие книги не кэшируем целиком: страница будет перечитываться,
            // зато память не растёт пропорционально библиотеке пользователя
            if (ShouldCacheText(pages.Sum(p => (long)p.Length)))
            {
                _cache.Set(cacheKey, pages, PagesCacheTtl);
            }

            return pages;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read EPUB content for book {BookId}", bookId);
            return null;
        }
    }

    public async Task<BookContent?> GetBookContentAsync(string userId, int bookId, int page = 1, int pageSize = 300)
    {
        var book = await GetBookAsync(userId, bookId);
        if (book == null) return null;

        var pages = await GetPagesAsync(bookId, pageSize);
        if (pages == null || pages.Count == 0) return null;

        var totalWords = pages.Sum(p => p.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length);
        var totalPages = pages.Count;

        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;

        var pageText = pages[page - 1];
        var pageWordCount = pageText.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
        var wordsRead = Math.Min((page - 1) * pageSize + pageWordCount, totalWords);
        var progress = totalWords > 0 ? (double)wordsRead / totalWords * 100 : 0;

        // Сохраняем прогресс (округлённый до 0.1 — в списке книг отдаётся как есть)
        book.CurrentPage = page;
        book.TotalPages = totalPages;
        book.Progress = Math.Round(progress, 1);
        await _context.SaveChangesAsync();

        return new BookContent
        {
            Text = pageText,
            CurrentPage = page,
            TotalPages = totalPages,
            TotalWords = totalWords,
            WordsRead = wordsRead
        };
    }

    // Вырезаем служебную заставку и подвал Project Gutenberg,
    // чтобы книга начиналась с реального текста, а не с лицензии
    private static string StripGutenbergFrontMatter(string text)
    {
        var trimmed = text.Trim();
        var startIdx = trimmed.IndexOf("*** START OF THE PROJECT GUTENBERG EBOOK", StringComparison.OrdinalIgnoreCase);
        if (startIdx < 0) return trimmed;

        // пропускаем строку с маркером
        var lineEnd = trimmed.IndexOf('\n', startIdx);
        if (lineEnd < 0) return trimmed;

        var endIdx = trimmed.IndexOf("*** END OF THE PROJECT GUTENBERG EBOOK", lineEnd, StringComparison.OrdinalIgnoreCase);
        var content = endIdx > lineEnd
            ? trimmed.Substring(lineEnd + 1, endIdx - lineEnd - 1)
            : trimmed.Substring(lineEnd + 1);

        return content.Trim();
    }

    internal static string CleanHtml(string html)
    {
        if (string.IsNullOrEmpty(html))
            return string.Empty;

        // Убираем script и style полностью
        html = Regex.Replace(html, @"<script[^>]*>.*?</script>", "", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        html = Regex.Replace(html, @"<style[^>]*>.*?</style>", "", RegexOptions.Singleline | RegexOptions.IgnoreCase);

        // Убираем все HTML теги
        html = Regex.Replace(html, @"<[^>]+>", " ");

        // Убираем CSS-стили в фигурных скобках
        html = Regex.Replace(html, @"\{[^}]*\}", " ");

        // Убираем HTML сущности
        html = html.Replace("&nbsp;", " ")
                   .Replace("&quot;", "\"")
                   .Replace("&amp;", "&")
                   .Replace("&lt;", "<")
                   .Replace("&gt;", ">")
                   .Replace("&#39;", "'")
                   .Replace("&apos;", "'")
                   .Replace("&ldquo;", "\"")
                   .Replace("&rdquo;", "\"")
                   .Replace("&lsquo;", "'")
                   .Replace("&rsquo;", "'")
                   .Replace("&mdash;", "—")
                   .Replace("&ndash;", "–");

        // Убираем лишние пробелы
        html = Regex.Replace(html, @"\s+", " ");

        return html.Trim();
    }

    public async Task<bool> DeleteBookAsync(string userId, int bookId)
    {
        var book = await GetBookAsync(userId, bookId);
        if (book == null) return false;

        var filePath = Path.Combine(_environment.ContentRootPath, "uploads", "books", book.FilePath);
        if (File.Exists(filePath))
        {
            File.Delete(filePath);
        }

        _context.Books.Remove(book);
        await _context.SaveChangesAsync();

        return true;
    }

    /// <summary>
    /// Оглавление книги: главы из EPUB-навигации с номером страницы, на которой
    /// глава начинается. Глава ищется по первым словам её текста — точнее
    /// привязка к страницам ~300 слов не строится. Результат кэшируется:
    /// содержимое книги неизменно.
    /// </summary>
    public async Task<List<BookTocItem>?> GetTableOfContentsAsync(int bookId, int pageSize = 300)
    {
        var cacheKey = $"booktoc:{bookId}:{pageSize}";
        if (_cache.TryGetValue(cacheKey, out List<BookTocItem>? cached) && cached != null)
        {
            return cached;
        }

        var book = await _context.Books.AsNoTracking().FirstOrDefaultAsync(b => b.Id == bookId);
        if (book == null) return null;

        var filePath = Path.Combine(_environment.ContentRootPath, "uploads", "books", book.FilePath);
        if (!File.Exists(filePath)) return null;

        var pages = await GetPagesAsync(bookId, pageSize);
        if (pages == null || pages.Count == 0) return null;

        try
        {
            var epubBook = await EpubReader.ReadBookAsync(filePath);

            var navigation = new List<NavEntry>();
            FlattenNavigation(epubBook.Navigation, 0, navigation);

            var items = new List<BookTocItem>();
            var lastPage = 1;

            foreach (var entry in navigation)
            {
                var page = lastPage;

                var chapterHtml = entry.Content;
                if (chapterHtml == null && !string.IsNullOrWhiteSpace(entry.FilePath))
                {
                    chapterHtml = epubBook.ReadingOrder
                        .FirstOrDefault(c => FileNamesMatch(c.FilePath, entry.FilePath))?.Content;
                }

                if (!string.IsNullOrWhiteSpace(chapterHtml))
                {
                    var snippet = BuildSnippet(CleanHtml(chapterHtml));
                    if (snippet.Length > 0)
                    {
                        var found = pages.FindIndex(p => p.Contains(snippet, StringComparison.OrdinalIgnoreCase));
                        if (found >= 0)
                        {
                            page = found + 1;
                        }
                    }
                }

                lastPage = page;
                items.Add(new BookTocItem(entry.Title, page, entry.Level));
            }

            _cache.Set(cacheKey, items, TocCacheTtl);
            return items;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read EPUB navigation for book {BookId}", bookId);
            return null;
        }
    }

    private static readonly TimeSpan TocCacheTtl = TimeSpan.FromHours(6);

    private sealed record NavEntry(string Title, string? Content, string? FilePath, int Level);

    private static void FlattenNavigation(
        List<EpubNavigationItem>? source,
        int level,
        List<NavEntry> target)
    {
        if (source == null) return;

        foreach (var item in source)
        {
            var title = item.Title?.Trim();
            if (!string.IsNullOrEmpty(title))
            {
                target.Add(new NavEntry(
                    title,
                    item.HtmlContentFile?.Content,
                    item.HtmlContentFile?.FilePath ?? item.Link?.ContentFilePath,
                    level));
            }

            FlattenNavigation(item.NestedItems, level + 1, target);
        }
    }

    private static bool FileNamesMatch(string? filePath, string? contentFileName)
    {
        if (string.IsNullOrWhiteSpace(filePath) || string.IsNullOrWhiteSpace(contentFileName))
        {
            return false;
        }

        var left = filePath.Replace('\\', '/');
        var right = contentFileName.Replace('\\', '/');

        return left.Equals(right, StringComparison.OrdinalIgnoreCase) ||
               left.EndsWith("/" + right, StringComparison.OrdinalIgnoreCase) ||
               right.EndsWith("/" + left, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(Path.GetFileName(left), Path.GetFileName(right), StringComparison.OrdinalIgnoreCase);
    }

    // Первые слова главы — маркер для поиска страницы. Шесть слов достаточно,
    // чтобы не спутать главы, и мало, чтобы не разорваться на границе страницы.
    private static string BuildSnippet(string chapterText)
    {
        if (string.IsNullOrWhiteSpace(chapterText))
        {
            return string.Empty;
        }

        var words = chapterText.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var snippet = string.Join(' ', words.Take(6));

        return snippet.Length >= 15 ? snippet : string.Empty;
    }
}

public record BookTocItem(string Title, int Page, int Level);

public class BookContent
{
    public string Text { get; set; } = string.Empty;
    public int CurrentPage { get; set; }
    public int TotalPages { get; set; }
    public int TotalWords { get; set; }
    public int WordsRead { get; set; }
    public int Progress => TotalWords > 0 ? (int)((double)WordsRead / TotalWords * 100) : 0;
}