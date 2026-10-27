using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Security;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Загрузка книги из админки.
///
/// Пользовательская загрузка (<c>POST /api/books/upload</c>) привязывает книгу
/// к аккаунту: строка получает UploadedByUserId, и книга видна только автору.
/// Админская — кладёт книгу в общий каталог: <c>UploadedByUserId == null</c>,
/// и её видят все читатели (гостевая витрина читает именно такие строки).
///
/// Проверки файла не дублируются: <see cref="BookService.UploadBookAsync"/>
/// уже отклоняет не-EPUB, больше 50 МБ и архивы-бомбы. Здесь только роль и
/// передача владельца.
/// </summary>
[ApiController]
[Route("api/admin/content/books")]
[Authorize(Roles = AppRoles.Admin)]
[EnableRateLimiting("upload")]
public class AdminBooksController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly BookService _bookService;
    private readonly ContentCacheInvalidator _cache;
    private readonly ILogger<AdminBooksController> _logger;

    public AdminBooksController(
        ApplicationDbContext context,
        BookService bookService,
        ContentCacheInvalidator cache,
        ILogger<AdminBooksController> logger)
    {
        _context = context;
        _bookService = bookService;
        _cache = cache;
        _logger = logger;
    }

    private string AdminId =>
        User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "admin";

    /// <summary>
    /// Загрузить EPUB в общий каталог.
    ///
    /// Владелец остаётся null: это и есть «публичная». Иначе книга попадёт в
    /// личную библиотеку администратора и никто её не увидит.
    /// </summary>
    [HttpPost("upload")]
    [RequestSizeLimit(64 * 1024 * 1024)]
    public async Task<ActionResult<object>> Upload(IFormFile? file, CancellationToken ct)
    {
        if (file == null || file.Length == 0)
        {
            return BadRequest(new { message = "Файл не передан." });
        }

        // BookService.UploadBookAsync принимает userId и ставит его владельцем.
        // Передаём пустую строку, а сразу после сохранения обнуляем — иначе
        // строка с "": выглядит как владелец и не находится запросом
        // «UploadedByUserId == null».
        var book = await _bookService.UploadBookAsync(string.Empty, file);

        if (book == null)
        {
            return BadRequest(new
            {
                message = "Файл не принят. Нужен EPUB не больше 50 МБ — " +
                          "и архив должен распаковываться в разумный объём."
            });
        }

        book.UploadedByUserId = null;
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateBooks(book.Id);

        _logger.LogInformation(
            "Админ {AdminId} добавил книгу в общий каталог: {Title} (id {BookId}, {Size} байт)",
            AdminId, book.Title, book.Id, book.FileSize);

        return Ok(new
        {
            id = book.Id,
            title = book.Title,
            author = book.Author,
            cefrLevel = book.CefrLevel,
            fileSize = book.FileSize,
            coverUrl = book.CoverUrl
        });
    }
}
