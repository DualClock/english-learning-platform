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

        var extension = Path.GetExtension(file.FileName).ToLower();
        if (extension != ".epub")
            return null;

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
            language = book.Schema.Package.Metadata.Languages?.FirstOrDefault()?.ToString();

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

    public async Task<List<Book>> GetUserBooksAsync(string userId)
    {
        return await _context.Books
            .Where(b => b.UploadedByUserId == userId)
            .OrderByDescending(b => b.CreatedAt)
            .ToListAsync();
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
            _cache.Set(cacheKey, pages, PagesCacheTtl);
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

    private string CleanHtml(string html)
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
}

public class BookContent
{
    public string Text { get; set; } = string.Empty;
    public int CurrentPage { get; set; }
    public int TotalPages { get; set; }
    public int TotalWords { get; set; }
    public int WordsRead { get; set; }
    public int Progress => TotalWords > 0 ? (int)((double)WordsRead / TotalWords * 100) : 0;
}