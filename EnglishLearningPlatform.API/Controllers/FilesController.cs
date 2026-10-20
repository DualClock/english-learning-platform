using System.Security.Claims;
using System.Text.RegularExpressions;
using EnglishLearningPlatform.API.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

// Отдача пользовательских файлов (аватары и EPUB) вместо публичной статики.
// Раньше /uploads раздавался целиком, поэтому любой, кто знал GUID-ссылку,
// мог скачать чужую книгу или аватар. Теперь доступ проверяется по владельцу.
[ApiController]
[Route("api/files")]
[Authorize]
public partial class FilesController : ControllerBase
{
    private static readonly Dictionary<string, string> AvatarContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg",
        [".png"] = "image/png",
        [".webp"] = "image/webp"
    };

    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;

    public FilesController(ApplicationDbContext context, IWebHostEnvironment environment)
    {
        _context = context;
        _environment = environment;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // Имя загруженного аватара — GUID без дефисов + расширение (см. AvatarService)
    [GeneratedRegex(@"^[a-f0-9]{32}\.(jpg|png|webp)$")]
    private static partial Regex AvatarFileNameRegex();

    // GET: api/files/avatars/{fileName}
    [HttpGet("avatars/{fileName}")]
    public async Task<IActionResult> GetAvatar(string fileName)
    {
        if (!AvatarFileNameRegex().IsMatch(fileName)) return NotFound();

        // Отдаём файл только его владельцу: ищем пользователя, у которого
        // в AvatarUrl записан именно этот файл.
        var userId = GetUserId();
        var avatarUrl = $"/uploads/avatars/{fileName}";
        var isOwner = await _context.Users
            .AsNoTracking()
            .AnyAsync(u => u.Id == userId && u.AvatarUrl == avatarUrl);
        if (!isOwner) return NotFound();

        var path = Path.Combine(AvatarDirectory(), fileName);
        if (!System.IO.File.Exists(path)) return NotFound();

        var extension = Path.GetExtension(fileName);
        var contentType = AvatarContentTypes.TryGetValue(extension, out var type) ? type : "application/octet-stream";

        // Аватар личный: кэшировать можно только в браузере, не в общих прокси
        Response.Headers.CacheControl = "private, max-age=300";
        return PhysicalFile(path, contentType);
    }

    // GET: api/files/books/{id}
    // EPUB скачивается только владельцем; книги без автора (публичные) — любому вошедшему.
    [HttpGet("books/{id:int}")]
    public async Task<IActionResult> GetBookFile(int id)
    {
        var userId = GetUserId();
        var book = await _context.Books.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id);
        if (book == null) return NotFound();

        if (!string.IsNullOrEmpty(book.UploadedByUserId) && book.UploadedByUserId != userId)
            return NotFound();

        // Имя файла из БД всегда без путей, но GetFileName защищает от старых кривых записей
        var fileName = Path.GetFileName(book.FilePath);
        if (string.IsNullOrEmpty(fileName)) return NotFound();

        var path = Path.Combine(BooksDirectory(), fileName);
        if (!System.IO.File.Exists(path)) return NotFound();

        Response.Headers.CacheControl = "private, max-age=60";
        // enableRangeProcessing нужен для докачки и корректной работы читалок EPUB
        return PhysicalFile(path, "application/epub+zip", enableRangeProcessing: true);
    }

    private string UploadsDirectory() =>
        Path.Combine(_environment.ContentRootPath, "uploads");

    private string AvatarDirectory() =>
        Path.Combine(UploadsDirectory(), "avatars");

    private string BooksDirectory() =>
        Path.Combine(UploadsDirectory(), "books");
}
