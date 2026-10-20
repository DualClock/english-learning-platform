using System.Security.Claims;
using System.Text.RegularExpressions;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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
    private readonly AiService _aiService;
    private readonly ReaderDifficultyService _difficultyService;
    private readonly IMemoryCache _cache;
    private readonly ILogger<BooksController> _logger;

    // Один конструктор с обоими сервисами
    public BooksController(BookService bookService, PopularBooksService popularBooksService, StorySeeder storySeeder, ApplicationDbContext context, ActivityService activityService, BookAnalyzerService analyzerService, AiService aiService, ReaderDifficultyService difficultyService, IMemoryCache cache, ILogger<BooksController> logger)
    {
        _bookService = bookService;
        _popularBooksService = popularBooksService;
        _storySeeder = storySeeder;
        _context = context;
        _activityService = activityService;
        _analyzerService = analyzerService;
        _aiService = aiService;
        _difficultyService = difficultyService;
        _cache = cache;
        _logger = logger;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // POST: api/books/upload
    [HttpPost("upload")]
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

    // GET: api/books/5/word-tooltip?word=thirteen
    [HttpGet("{id}/word-tooltip")]
    public async Task<IActionResult> GetWordTooltip(int id, [FromQuery] string word)
    {
        var book = await _bookService.GetBookAsync(GetUserId(), id);
        if (book == null) return NotFound();

        var normalized = BookAnalyzerService.Normalize(word ?? "");
        if (normalized.Length < 2) return BadRequest(new { message = "Invalid word" });

        // Маркерные слова всегда есть в справочнике WordLevels — отвечаем мгновенно,
        // без обращения к AI (оно может занимать секунды и подвешивает тултип)
        var level = await _context.WordLevels.AsNoTracking()
            .FirstOrDefaultAsync(wl => wl.Text == normalized);

        return Ok(new
        {
            word = normalized,
            cefrLevel = level?.CefrLevel,
            translationRu = level?.TranslationRu,
            freqRank = level?.FreqRank,
            translation = (string?)null
        });
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

    // GET: api/books/5/content
    // GET: api/books/5/content?page=1
    [HttpGet("{id}/content")]
    public async Task<IActionResult> GetBookContent(int id, [FromQuery] int page = 1)
    {
        var userId = GetUserId();

        // Трекаем прочитанную страницу только если это движение вперёд
        var currentPage = await _context.Books.AsNoTracking()
            .Where(b => b.Id == id && b.UploadedByUserId == userId)
            .Select(b => (int?)b.CurrentPage)
            .FirstOrDefaultAsync();

        if (currentPage.HasValue && page > currentPage.Value)
        {
            await _activityService.TrackAsync(userId, "read_page", 1);
        }

        var content = await _bookService.GetBookContentAsync(userId, id, page);

        if (content == null)
        {
            return NotFound();
        }

        var keyWords = await _context.BookKeyWords.AsNoTracking()
            .Where(bk => bk.BookId == id && bk.Page == page)
            .OrderBy(bk => bk.FreqRank)
            .Select(bk => new { wordText = bk.WordText, cefrLevel = bk.CefrLevel })
            .ToListAsync();

        return Ok(new
        {
            content.Text,
            content.CurrentPage,
            content.TotalPages,
            content.TotalWords,
            content.WordsRead,
            keyWords
        });
    }

    // GET: api/books/5/parallel?page=1 — страница с параллельным переводом en→ru.
    // Текст страницы режется на предложения, группируется в чанки по 2-3 предложения
    // (≤600 символов). Весь текст страницы переводится одним литературным вызовом
    // Gemini (TranslateLiteraryAsync); при расхождении числа сегментов — поблочный
    // gtx-фолбэк. Результат кэшируется 24ч.
    [HttpGet("{id}/parallel")]
    public async Task<IActionResult> GetParallelPage(int id, [FromQuery] int page = 1)
    {
        var userId = GetUserId();

        var book = await _bookService.GetBookAsync(userId, id);
        if (book == null) return NotFound();

        var cacheKey = $"parallel:{id}:{page}";
        if (_cache.TryGetValue(cacheKey, out List<ParallelChunk>? cached) && cached != null)
        {
            return Ok(new { chunks = cached });
        }

        var pages = await _bookService.GetPagesAsync(id);
        if (pages == null || pages.Count == 0) return NotFound();
        if (page < 1 || page > pages.Count) return NotFound();

        var chunks = await TranslateChunksAsync(BuildTranslationChunks(pages[page - 1]), userId);

        _cache.Set(cacheKey, chunks, ParallelPageCacheTtl);

        return Ok(new { chunks });
    }

    // Один литературный вызов на страницу: чанки EN склеиваются через "\n\n",
    // ответ разбивается по "\n\n" обратно. Если модель вернула другое число
    // сегментов или упала — переводим каждый чанк через gtx по отдельности.
    private async Task<List<ParallelChunk>> TranslateChunksAsync(List<ParallelChunk> chunks, string? userId = null)
    {
        if (chunks.Count == 0)
        {
            return chunks;
        }

        var joined = string.Join("\n\n", chunks.Select(c => c.En));
        var literary = await _aiService.TranslateLiteraryAsync(joined, userId);

        if (literary != null)
        {
            var parts = literary
                .Split("\n\n")
                .Select(p => p.Trim())
                .Where(p => p.Length > 0)
                .ToList();

            if (parts.Count == chunks.Count)
            {
                return chunks.Zip(parts, (chunk, ru) => chunk with { Ru = ru }).ToList();
            }

            _logger.LogWarning(
                "Literary translation returned {Parts} segments for {Chunks} chunks, falling back to per-chunk gtx",
                parts.Count, chunks.Count);
        }

        var translations = await Task.WhenAll(
            chunks.Select(chunk => _aiService.TranslateTextAsync(chunk.En)));

        return chunks.Zip(translations, (chunk, ru) => chunk with { Ru = ru }).ToList();
    }

    private static readonly TimeSpan ParallelPageCacheTtl = TimeSpan.FromHours(24);

    private const int MaxChunkSentences = 3;
    private const int MaxChunkLength = 600;

    // Разбивка на предложения (по [.!?…] с учётом закрывающих кавычек/скобок),
    // затем группировка в чанки: максимум 3 предложения и 600 символов
    internal static List<ParallelChunk> BuildTranslationChunks(string text)
    {
        var chunks = new List<ParallelChunk>();
        if (string.IsNullOrWhiteSpace(text))
        {
            return chunks;
        }

        var sentences = Regex
            .Split(text.Trim(), @"(?<=[.!?…][""”’')\]]*)\s+")
            .Select(s => s.Trim())
            .Where(s => s.Length > 0)
            .ToList();

        var current = new List<string>();
        var currentLength = 0;

        foreach (var sentence in sentences)
        {
            if (current.Count >= MaxChunkSentences ||
                currentLength > 0 && currentLength + sentence.Length + 1 > MaxChunkLength)
            {
                chunks.Add(new ParallelChunk(string.Join(" ", current), null));
                current = new List<string>();
                currentLength = 0;
            }

            current.Add(sentence);
            currentLength += sentence.Length + 1;
        }

        if (current.Count > 0)
        {
            chunks.Add(new ParallelChunk(string.Join(" ", current), null));
        }

        return chunks;
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

    // GET: api/books/5/difficulty — доля знакомых/изучаемых/новых слов по страницам
    [HttpGet("{id}/difficulty")]
    public async Task<IActionResult> GetDifficulty(int id)
    {
        var userId = GetUserId();

        var book = await _bookService.GetBookAsync(userId, id);
        if (book == null) return NotFound();

        var difficulty = await _difficultyService.GetAsync(userId, id);
        if (difficulty == null) return NotFound();

        static object Map(PageDifficulty page) => new
        {
            page = page.Page,
            totalWords = page.TotalWords,
            known = page.KnownWords,
            learning = page.LearningWords,
            newWords = page.NewWords,
            knownPercent = page.KnownPercent,
            learningPercent = page.LearningPercent,
            newPercent = page.NewPercent
        };

        return Ok(new
        {
            pages = difficulty.Pages.Select(Map).ToList(),
            average = Map(difficulty.Average),
            totalWords = difficulty.TotalWords,
            knownWordCount = difficulty.KnownWordCount,
            learningWordCount = difficulty.LearningWordCount
        });
    }

    // GET: api/books/5/toc — оглавление с номерами страниц
    [HttpGet("{id}/toc")]
    public async Task<IActionResult> GetToc(int id)
    {
        var book = await _bookService.GetBookAsync(GetUserId(), id);
        if (book == null) return NotFound();

        var items = await _bookService.GetTableOfContentsAsync(id);

        return Ok(new
        {
            items = (items ?? new List<BookTocItem>()).Select(i => new
            {
                title = i.Title,
                page = i.Page,
                level = i.Level
            }),
            count = items?.Count ?? 0
        });
    }

    // GET: api/books/5/bookmarks
    [HttpGet("{id}/bookmarks")]
    public async Task<IActionResult> GetBookmarks(int id)
    {
        var userId = GetUserId();

        var book = await _bookService.GetBookAsync(userId, id);
        if (book == null) return NotFound();

        var items = await _context.BookBookmarks.AsNoTracking()
            .Where(b => b.BookId == id && b.UserId == userId)
            .OrderBy(b => b.Page)
            .Select(b => new { id = b.Id, page = b.Page, note = b.Note, createdAt = b.CreatedAt })
            .ToListAsync();

        return Ok(new { items });
    }

    // POST: api/books/5/bookmarks — поставить/обновить закладку на странице
    [HttpPost("{id}/bookmarks")]
    public async Task<IActionResult> UpsertBookmark(int id, [FromBody] BookmarkRequest request)
    {
        var userId = GetUserId();

        var book = await _bookService.GetBookAsync(userId, id);
        if (book == null) return NotFound();

        if (request == null || request.Page < 1)
        {
            return BadRequest(new { error = "Некорректный номер страницы." });
        }

        var note = request.Note?.Trim();
        if (note is { Length: > 500 })
        {
            return BadRequest(new { error = "Заметка слишком длинная (максимум 500 символов)." });
        }

        var bookmark = await _context.BookBookmarks
            .FirstOrDefaultAsync(b => b.BookId == id && b.UserId == userId && b.Page == request.Page);

        if (bookmark == null)
        {
            bookmark = new BookBookmark
            {
                BookId = id,
                UserId = userId,
                Page = request.Page,
                Note = string.IsNullOrWhiteSpace(note) ? null : note
            };
            _context.BookBookmarks.Add(bookmark);
        }
        else
        {
            bookmark.Note = string.IsNullOrWhiteSpace(note) ? null : note;
        }

        await _context.SaveChangesAsync();

        return Ok(new
        {
            id = bookmark.Id,
            page = bookmark.Page,
            note = bookmark.Note,
            createdAt = bookmark.CreatedAt
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
public record ParallelChunk(string En, string? Ru);

public class BookmarkRequest
{
    public int Page { get; set; }
    public string? Note { get; set; }
}