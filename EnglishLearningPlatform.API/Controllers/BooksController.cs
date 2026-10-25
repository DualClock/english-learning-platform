using System.Security.Claims;
using System.Text.RegularExpressions;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Security;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class BooksController : ControllerBase
{
    private readonly BookService _bookService;
    private readonly PopularBooksService _popularBooksService;
    private readonly StorySeeder _storySeeder;
    private readonly ApplicationDbContext _context;
    private readonly ActivityService _activityService;
    private readonly BookAnalyzerService _analyzerService;
    private readonly Services.Reader.ReaderContentService _readerContentService;
    private readonly IMemoryCache _cache;
    private readonly ILogger<BooksController> _logger;

    // Один конструктор с обоими сервисами
    public BooksController(BookService bookService, PopularBooksService popularBooksService, StorySeeder storySeeder, ApplicationDbContext context, ActivityService activityService, BookAnalyzerService analyzerService, Services.Reader.ReaderContentService readerContentService, IMemoryCache cache, ILogger<BooksController> logger)
    {
        _bookService = bookService;
        _popularBooksService = popularBooksService;
        _storySeeder = storySeeder;
        _context = context;
        _activityService = activityService;
        _analyzerService = analyzerService;
        _readerContentService = readerContentService;
        _cache = cache;
        _logger = logger;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // POST: api/books/upload
    [HttpPost("upload")]
    [EnableRateLimiting("upload")]
    public async Task<IActionResult> UploadBook(IFormFile file)
    {
        if (file == null || file.Length == 0)
        {
            return BadRequest(new { message = "No file uploaded" });
        }

        var book = await _bookService.UploadBookAsync(GetUserId(), file);

        if (book == null)
        {
            return BadRequest(new { message = "Invalid file. Only EPUB supported." });
        }

        await AnalyzeBookAsync(book.Id);

        return Ok(new
        {
            id = book.Id,
            title = book.Title,
            author = book.Author,
            language = book.Language,
            fileSize = book.FileSize,
            coverUrl = book.CoverUrl
        });
    }

    // Анализ книги: строит кэш страниц и маркерные слова. ВАЖНО: работает без AI.
    // Здесь же готовим структурный снимок читалки: первый открытый текст не
    // должен разбирать EPUB на глазах у человека.
    private async Task AnalyzeBookAsync(int bookId)
    {
        try
        {
            await _analyzerService.AnalyzeAsync(bookId);
        }
        catch (Exception ex)
        {
            // Анализ не должен ломать добавление книги
            _logger.LogWarning(ex, "Book analysis failed for {BookId}", bookId);
        }

        try
        {
            await _readerContentService.EnsureSnapshotAsync(bookId);
        }
        catch (Exception ex)
        {
            // Старая читалка продолжает работать; новая разберёт книгу при открытии
            _logger.LogWarning(ex, "Reader snapshot failed for {BookId}", bookId);
        }
    }

    // GET: api/books?page=1&pageSize=20
    [HttpGet]
    public async Task<IActionResult> GetBooks([FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var (books, totalCount) = await _bookService.GetUserBooksAsync(GetUserId(), page, pageSize);

        var items = books.Select(b =>
        {
            // Старые данные могли хранить прогресс в 0..1 — нормализуем к процентам
            var progress = b.Progress;
            if (progress < 1)
            {
                progress *= 100;
            }

            progress = Math.Clamp(progress, 0, 100);

            return new
            {
                id = b.Id,
                title = b.Title,
                author = b.Author,
                language = b.Language,
                fileSize = b.FileSize,
                createdAt = b.CreatedAt,
                coverUrl = b.CoverUrl,
                progress = Math.Round(progress, 1),
                currentPage = b.CurrentPage,
                totalPages = b.TotalPages,
                cefrLevel = b.CefrLevel
            };
        }).ToList();

        return Ok(new
        {
            items,
            page,
            pageSize,
            totalCount,
            totalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
        });
    }

    // GET: api/books/popular — каталог с обложками (кэш 24ч, Open Library)
    [HttpGet("popular")]
    public async Task<IActionResult> GetPopularBooks()
    {
        var books = await _popularBooksService.GetPopularBooksWithCoversAsync();
        return Ok(books);
    }

    // POST: api/books/popular/{gutenbergId}
    [HttpPost("popular/{gutenbergId}")]
    public async Task<IActionResult> AddPopularBook(string gutenbergId)
    {
        var book = await _popularBooksService.AddPopularBookAsync(GetUserId(), gutenbergId);

        if (book == null)
        {
            return BadRequest(new { message = "Failed to add book" });
        }

        await AnalyzeBookAsync(book.Id);

        return Ok(new
        {
            id = book.Id,
            title = book.Title,
            author = book.Author
        });
    }

    // POST: api/books/refresh-covers — подтянуть обложки с Open Library для книг
    // пользователя без CoverUrl. Максимум 5 книг за вызов, чтобы не долбить Open Library.
    [HttpPost("refresh-covers")]
    public async Task<IActionResult> RefreshCovers()
    {
        var userId = GetUserId();

        var books = await _context.Books
            .Where(b => b.UploadedByUserId == userId &&
                        (b.CoverUrl == null || b.CoverUrl == ""))
            .OrderBy(b => b.Id)
            .Take(5)
            .ToListAsync();

        var updated = 0;
        foreach (var book in books)
        {
            await _popularBooksService.TrySetCoverUrlAsync(book);
            if (!string.IsNullOrEmpty(book.CoverUrl))
            {
                updated++;
            }
        }

        var remaining = await _context.Books
            .Where(b => b.UploadedByUserId == userId &&
                        (b.CoverUrl == null || b.CoverUrl == ""))
            .CountAsync();

        return Ok(new { updated, remaining });
    }

    // GET: api/books/stories — градированные рассказы A1–B1
    [HttpGet("stories")]
    public async Task<IActionResult> GetStories()
    {
        var userId = GetUserId();
        var stories = _storySeeder.GetStories();

        var userTitles = await _context.Books.AsNoTracking()
            .Where(b => b.UploadedByUserId == userId)
            .Select(b => b.Title)
            .ToListAsync();
        var userTitleSet = userTitles.ToHashSet(StringComparer.OrdinalIgnoreCase);

        return Ok(stories.Select((s, index) => new
        {
            index,
            title = s.Title,
            cefrLevel = s.CefrLevel,
            description = s.Description,
            coverUrl = _storySeeder.EnsureCoverUrl(index, s),
            alreadyAdded = userTitleSet.Contains(s.Title)
        }));
    }

    // POST: api/books/story/{index} — копия рассказа как книга текущего пользователя
    [HttpPost("story/{index}")]
    public async Task<IActionResult> AddStory(int index)
    {
        var story = _storySeeder.GetStory(index);
        if (story == null)
        {
            return NotFound(new { message = "Story not found" });
        }

        var userId = GetUserId();

        // Дедуп по Title — как у популярных книг
        var existing = await _context.Books.AsNoTracking()
            .FirstOrDefaultAsync(b => b.UploadedByUserId == userId && b.Title == story.Title);

        if (existing != null)
        {
            return Ok(new
            {
                id = existing.Id,
                title = existing.Title,
                author = existing.Author,
                alreadyAdded = true
            });
        }

        var book = await _storySeeder.CreateBookForUserAsync(userId, story, index);
        if (book == null)
        {
            return BadRequest(new { message = "Failed to create story book" });
        }

        await AnalyzeBookAsync(book.Id);

        // Анализ переоценивает CefrLevel по маркерным словам — возвращаем уровень из сид-данных
        var tracked = await _context.Books.FirstOrDefaultAsync(b => b.Id == book.Id);
        if (tracked != null && tracked.CefrLevel != story.CefrLevel)
        {
            tracked.CefrLevel = story.CefrLevel;
            await _context.SaveChangesAsync();
        }

        return Ok(new
        {
            id = book.Id,
            title = book.Title,
            author = book.Author,
            alreadyAdded = false
        });
    }

    // POST: api/books/5/reanalyze
    [HttpPost("{id}/reanalyze")]
    public async Task<IActionResult> Reanalyze(int id)
    {
        var book = await _bookService.GetBookAsync(GetUserId(), id);
        if (book == null) return NotFound();

        await AnalyzeBookAsync(id);
        return Ok(new { message = "Analysis complete" });
    }

    // GET: api/books/5
    [HttpGet("{id}")]
    public async Task<IActionResult> GetBook(int id)
    {
        var book = await _bookService.GetBookAsync(GetUserId(), id);

        if (book == null)
        {
            return NotFound();
        }

        return Ok(new
        {
            id = book.Id,
            title = book.Title,
            author = book.Author,
            language = book.Language
        });
    }

    // GET: api/books/recommended?level=b1
    [HttpGet("recommended")]
    public async Task<IActionResult> GetRecommendedBooks([FromQuery] string? level)
    {
        var userId = GetUserId();
        var books = _popularBooksService.GetPopularBooks();

        var userTitles = await _context.Books.AsNoTracking()
            .Where(b => b.UploadedByUserId == userId)
            .Select(b => b.Title)
            .ToListAsync();

        var userTitleSet = userTitles.ToHashSet(StringComparer.OrdinalIgnoreCase);

        var normalized = Normalize(level);

        IEnumerable<PopularBookInfo> ordered = normalized == null
            ? books.OrderBy(b => LevelOrder(b.CefrLevel))
            : books
                .Select(b => (Book: b, Distance: Math.Abs(LevelOrder(b.CefrLevel) - LevelOrder(normalized))))
                .Where(x => x.Distance <= 1)
                .OrderBy(x => x.Distance)
                .ThenBy(x => LevelOrder(x.Book.CefrLevel))
                .Select(x => x.Book);

        return Ok(ordered.Select(b => new
        {
            gutenbergId = b.GutenbergId,
            title = b.Title,
            author = b.Author,
            description = b.Description,
            cefrLevel = b.CefrLevel,
            alreadyAdded = userTitleSet.Contains(b.Title)
        }));
    }

    private static string? Normalize(string? l) => string.IsNullOrWhiteSpace(l) ? null : l.Trim().ToLowerInvariant();

    private static int LevelOrder(string? level) => Normalize(level) switch
    {
        "a1" => 1,
        "a2" => 2,
        "b1" => 3,
        "b2" => 4,
        "c1" => 5,
        "c2" => 6,
        _ => 0
    };

    // GET: api/books/5/bookmarks
    [HttpGet("{id}/bookmarks")]
    public async Task<IActionResult> GetBookmarks(int id)
    {
        var userId = GetUserId();

        var book = await _bookService.GetBookAsync(userId, id);
        if (book == null) return NotFound();

        var bookmarks = await _context.BookBookmarks.AsNoTracking()
            .Where(b => b.BookId == id && b.UserId == userId)
            .OrderBy(b => b.Page)
            .ThenBy(b => b.CreatedAt)
            .ToListAsync();

        var source = await _readerContentService.GetBookSnapshotAsync(userId, id);
        var items = bookmarks
            .Select(b => source == null
                ? new ReaderBookmarkDto
                {
                    Id = b.Id,
                    Page = b.Page,
                    ChapterId = b.ChapterId,
                    SentenceId = b.SentenceId,
                    CharOffset = b.CharOffset,
                    Excerpt = b.Excerpt,
                    Note = b.Note,
                    CreatedAt = b.CreatedAt
                }
                : ReaderContentService.ToBookmarkDto(b, source.Value.Snapshot))
            .ToList();

        return Ok(new { items, count = items.Count });
    }

    // POST: api/books/5/bookmarks — поставить/обновить закладку на странице
    [HttpPost("{id}/bookmarks")]
    public async Task<IActionResult> UpsertBookmark(int id, [FromBody] BookmarkRequest request)
    {
        var userId = GetUserId();

        var book = await _bookService.GetBookAsync(userId, id);
        if (book == null) return NotFound();

        if (request == null ||
            (string.IsNullOrWhiteSpace(request.ChapterId) && (request.Page is null || request.Page < 1)))
        {
            return BadRequest(new { error = "Нужна страница или предложение книги." });
        }

        var note = request.Note?.Trim();
        if (note is { Length: > 500 })
        {
            return BadRequest(new { error = "Заметка слишком длинная (максимум 500 символов)." });
        }

        string? chapterId = null;
        string? sentenceId = null;
        var charOffset = 0;
        string? excerpt = null;
        int? page = request.Page;

        if (!string.IsNullOrWhiteSpace(request.ChapterId))
        {
            var source = await _readerContentService.GetBookSnapshotAsync(userId, id);
            if (source == null)
            {
                return NotFound();
            }

            var chapter = ReaderContentService.FindChapter(source.Value.Snapshot, request.ChapterId);
            if (chapter == null)
            {
                return BadRequest(new { error = "Глава не найдена." });
            }

            var sentence = ReaderContentService.FindSentence(chapter, request.SentenceId);
            if (sentence == null)
            {
                return BadRequest(new { error = "Предложение не найдено." });
            }

            chapterId = chapter.Id;
            sentenceId = sentence.Id;
            charOffset = Math.Clamp(request.CharOffset, 0, Math.Max(0, sentence.Text.Length - 1));
            excerpt = sentence.Text.Length > 500 ? sentence.Text[..500] : sentence.Text;
            page = null;
        }

        var bookmark = chapterId != null
            ? await _context.BookBookmarks.FirstOrDefaultAsync(b =>
                b.BookId == id && b.UserId == userId &&
                b.ChapterId == chapterId && b.SentenceId == sentenceId)
            : await _context.BookBookmarks.FirstOrDefaultAsync(b =>
                b.BookId == id && b.UserId == userId && b.Page == request.Page);

        if (bookmark == null)
        {
            bookmark = new BookBookmark
            {
                BookId = id,
                UserId = userId,
                Page = page,
                ChapterId = chapterId,
                SentenceId = sentenceId,
                CharOffset = charOffset,
                Excerpt = excerpt,
                Note = string.IsNullOrWhiteSpace(note) ? null : note
            };
            _context.BookBookmarks.Add(bookmark);
        }
        else
        {
            bookmark.Page = page;
            bookmark.ChapterId = chapterId;
            bookmark.SentenceId = sentenceId;
            bookmark.CharOffset = charOffset;
            bookmark.Excerpt = excerpt;
            bookmark.Note = string.IsNullOrWhiteSpace(note) ? null : note;
        }

        await _context.SaveChangesAsync();

        return Ok(new ReaderBookmarkDto
        {
            Id = bookmark.Id,
            Page = bookmark.Page,
            ChapterId = bookmark.ChapterId,
            SentenceId = bookmark.SentenceId,
            CharOffset = bookmark.CharOffset,
            Excerpt = bookmark.Excerpt,
            Note = bookmark.Note,
            CreatedAt = bookmark.CreatedAt
        });
    }

    // DELETE: api/books/5/bookmarks/12
    [HttpDelete("{id}/bookmarks/{bookmarkId:int}")]
    public async Task<IActionResult> DeleteBookmark(int id, int bookmarkId)
    {
        var userId = GetUserId();

        var bookmark = await _context.BookBookmarks
            .FirstOrDefaultAsync(b => b.Id == bookmarkId && b.BookId == id && b.UserId == userId);

        if (bookmark == null) return NotFound();

        _context.BookBookmarks.Remove(bookmark);
        await _context.SaveChangesAsync();

        return NoContent();
    }

    // DELETE: api/books/5
    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteBook(int id)
    {
        var deleted = await _bookService.DeleteBookAsync(GetUserId(), id);

        if (!deleted)
        {
            return NotFound();
        }

        return NoContent();
    }
}

// Один блок параллельного чтения: en — оригинал, ru — перевод (null, если перевод не удался)

public class BookmarkRequest
{
    public int? Page { get; set; }
    public string? ChapterId { get; set; }
    public string? SentenceId { get; set; }
    public int CharOffset { get; set; }
    public string? Note { get; set; }
}