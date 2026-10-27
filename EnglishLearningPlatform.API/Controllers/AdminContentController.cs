using System.ComponentModel.DataAnnotations;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Security;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Админский CRUD над контентом: категории, слова в категориях, книги.
///
/// Правила, общие для всех экшенов здесь:
///
///  1. Только роль Admin. Проверяется на сервере, а не скрытием кнопки в UI —
///     см. EveryAdminRoute_RequiresAdminRole.
///
///  2. Удаление — мягкое. `DeletedAt` вместо DELETE: у пользователей есть
///     прогресс и SRS-карточки, ссылающиеся на эти строки. Физическое удаление
///     унесло бы чужие данные каскадом. Восстановление — обнуление поля.
///
///  3. После каждой правки сбрасываются кэши витрин (ContentCacheInvalidator).
///     Иначе админ сохраняет, а пользователь до шести часов видит старое.
/// </summary>
[ApiController]
[Route("api/admin/content")]
[Authorize(Roles = AppRoles.Admin)]
[EnableRateLimiting("admin")]
public class AdminContentController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly ContentCacheInvalidator _cache;
    private readonly ILogger<AdminContentController> _logger;

    public AdminContentController(
        ApplicationDbContext context,
        ContentCacheInvalidator cache,
        ILogger<AdminContentController> logger)
    {
        _context = context;
        _cache = cache;
        _logger = logger;
    }

    // Claims читаются через `User?`: контроллер обязан работать и там, где
    // HttpContext нет (юнит-тесты, внутренний вызов). Раньше здесь стоял
    // `User.FindFirst(...)?.Value!`, и без контекста это NullReferenceException.
    private string AdminId =>
        User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "admin";

    // ─────────────────────────────────────────────────────────────── категории

    [HttpGet("categories")]
    public async Task<ActionResult<object>> ListCategories(
        [FromQuery] bool includeDeleted = false,
        CancellationToken ct = default)
    {
        // Админка — единственное место, где удалённое надо ПОКАЗЫВАТЬ:
        // иначе восстановить категорию нечем.
        var query = _context.Categories
            .AsNoTracking()
            .Include(c => c.Words)
            .AsQueryable();

        if (includeDeleted)
        {
            query = query.IgnoreQueryFilters();
        }

        var categories = await query
            .OrderBy(c => c.Id)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Slug,
                c.Icon,
                c.Color,
                c.Description,
                c.DeletedAt,
                // У CategoryWord нет глобального фильтра (см. ApplicationDbContext),
                // поэтому удалённые слова отсекаются здесь явно.
                words = c.Words
                    .Where(w => includeDeleted || w.DeletedAt == null)
                    .OrderBy(w => w.Id)
                    .Select(w => new
                    {
                        w.Id,
                        w.English,
                        w.Translation,
                        w.Transcription,
                        w.Example,
                        w.ImageUrl,
                        w.DeletedAt
                    })
                    .ToList()
            })
            .ToListAsync(ct);

        return Ok(categories);
    }

    [HttpPost("categories")]
    public async Task<ActionResult<object>> CreateCategory([FromBody] CategoryUpsertDto dto, CancellationToken ct)
    {
        var slug = NormalizeSlug(dto.Slug, dto.Name);

        // Проверяем только живые: у частичного индекса удалённая строка слагов
        // не занимает, и создание одноимённой категории после удаления —
        // нормальный сценарий, а не конфликт.
        if (await _context.Categories.AnyAsync(c => c.Slug == slug, ct))
        {
            return Conflict(new { message = $"Категория со слагом «{slug}» уже существует." });
        }

        // Если раньше была удалённая категория с этим слагом — вернём её вместо
        // создания второй строки: уникальный индекс частичный, но два живых
        // ряда с одним слагом не должны появиться никогда.
        var removed = await _context.Categories
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.Slug == slug && c.DeletedAt != null, ct);

        if (removed != null)
        {
            removed.DeletedAt = null;
            removed.DeletedByUserId = null;
            removed.Name = dto.Name.Trim();
            removed.Icon = dto.Icon;
            removed.Color = dto.Color;
            removed.Description = dto.Description;

            await _context.SaveChangesAsync(ct);
            _cache.InvalidateCategories();

            _logger.LogInformation(
                "Админ {AdminId} восстановил категорию {Slug} вместо создания новой", AdminId, slug);

            return Ok(new { removed.Id, removed.Name, removed.Slug, restored = true });
        }

        var category = new Category
        {
            Name = dto.Name.Trim(),
            Slug = slug,
            Icon = dto.Icon,
            Color = dto.Color,
            Description = dto.Description
        };

        _context.Categories.Add(category);
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateCategories();
        _logger.LogInformation("Админ {AdminId} создал категорию {Slug}", AdminId, slug);

        return Ok(new { category.Id, category.Name, category.Slug, restored = false });
    }

    [HttpPut("categories/{id:int}")]
    public async Task<ActionResult<object>> UpdateCategory(
        int id, [FromBody] CategoryUpsertDto dto, CancellationToken ct)
    {
        var category = await _context.Categories.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (category == null) return NotFound(new { message = "Категория не найдена или удалена." });

        var slug = NormalizeSlug(dto.Slug, dto.Name);
        if (await _context.Categories.AnyAsync(c => c.Slug == slug && c.Id != id, ct))
        {
            return Conflict(new { message = $"Слаг «{slug}» занят другой категорией." });
        }

        category.Name = dto.Name.Trim();
        category.Slug = slug;
        category.Icon = dto.Icon;
        category.Color = dto.Color;
        category.Description = dto.Description;

        await _context.SaveChangesAsync(ct);

        _cache.InvalidateCategories();
        _logger.LogInformation("Админ {AdminId} изменил категорию {Id}", AdminId, id);

        return Ok(new { category.Id, category.Name, category.Slug });
    }

    [HttpDelete("categories/{id:int}")]
    public async Task<ActionResult<object>> DeleteCategory(int id, CancellationToken ct)
    {
        var category = await _context.Categories.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (category == null) return NotFound(new { message = "Категория не найдена." });

        // Мягкое удаление: слова остаются привязанными к категории, прогресс
        // пользователей не трогается. Восстановление вернёт категорию целиком.
        category.DeletedAt = DateTime.UtcNow;
        category.DeletedByUserId = AdminId;
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateCategories();
        _logger.LogInformation("Админ {AdminId} удалил категорию {Id} (мягко)", AdminId, id);

        return Ok(new { id, deletedAt = category.DeletedAt });
    }

    [HttpPost("categories/{id:int}/restore")]
    public async Task<ActionResult<object>> RestoreCategory(int id, CancellationToken ct)
    {
        var category = await _context.Categories
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.Id == id, ct);

        if (category == null) return NotFound(new { message = "Категория не найдена." });
        if (category.DeletedAt == null) return Ok(new { id, restored = false });

        category.DeletedAt = null;
        category.DeletedByUserId = null;
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateCategories();
        _logger.LogInformation("Админ {AdminId} восстановил категорию {Id}", AdminId, id);

        return Ok(new { id, restored = true });
    }

    // ──────────────────────────────────────────────────────────── слова в категории

    [HttpPost("categories/{categoryId:int}/words")]
    public async Task<ActionResult<object>> CreateWord(
        int categoryId, [FromBody] CategoryWordUpsertDto dto, CancellationToken ct)
    {
        var categoryExists = await _context.Categories.AnyAsync(c => c.Id == categoryId, ct);
        if (!categoryExists) return NotFound(new { message = "Категория не найдена или удалена." });

        var english = dto.English.Trim();

        // Уникальность (CategoryId, English) — индекс в БД. Проверяем заранее,
        // чтобы вернуть понятную ошибку вместо 500 с нарушением ограничения.
        // IgnoreQueryFilters: у CategoryWord нет глобального фильтра, но
        // удалённую строку тоже надо учесть — иначе INSERT упадёт на индексе.
        var existing = await _context.CategoryWords
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(w =>
                w.CategoryId == categoryId &&
                w.English.ToLower() == english.ToLower(), ct);

        if (existing != null)
        {
            if (existing.DeletedAt == null)
            {
                return Conflict(new { message = $"Слово «{english}» уже есть в этой категории." });
            }

            // Слово было удалено — восстановим и обновим данные, а не будем
            // плодить дубль: уникальный индекс иначе не пропустит.
            existing.DeletedAt = null;
            existing.DeletedByUserId = null;
            existing.Translation = dto.Translation.Trim();
            existing.Transcription = dto.Transcription;
            existing.Example = dto.Example;

            await _context.SaveChangesAsync(ct);
            _cache.InvalidateCategories();

            _logger.LogInformation(
                "Админ {AdminId} восстановил слово {Word} в категории {CategoryId}",
                AdminId, english, categoryId);

            return Ok(new { existing.Id, existing.English, restored = true });
        }

        var word = new CategoryWord
        {
            CategoryId = categoryId,
            English = english,
            Translation = dto.Translation.Trim(),
            Transcription = dto.Transcription,
            Example = dto.Example
        };

        _context.CategoryWords.Add(word);
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateCategories();
        _logger.LogInformation(
            "Админ {AdminId} добавил слово {Word} в категорию {CategoryId}",
            AdminId, english, categoryId);

        return Ok(new { word.Id, word.English, restored = false });
    }

    [HttpPut("words/{id:int}")]
    public async Task<ActionResult<object>> UpdateWord(
        int id, [FromBody] CategoryWordUpsertDto dto, CancellationToken ct)
    {
        // CategoryWord намеренно без глобального фильтра — удалённое слово
        // находится обычным запросом и здесь только отсекается явно.
        var word = await _context.CategoryWords.FirstOrDefaultAsync(w => w.Id == id, ct);
        if (word == null) return NotFound(new { message = "Слово не найдено." });
        if (word.DeletedAt != null) return NotFound(new { message = "Слово удалено — сначала восстановите." });

        word.English = dto.English.Trim();
        word.Translation = dto.Translation.Trim();
        word.Transcription = dto.Transcription;
        word.Example = dto.Example;

        await _context.SaveChangesAsync(ct);

        _cache.InvalidateCategories();
        _logger.LogInformation("Админ {AdminId} изменил слово {Id}", AdminId, id);

        return Ok(new { word.Id, word.English });
    }

    [HttpDelete("words/{id:int}")]
    public async Task<ActionResult<object>> DeleteWord(int id, CancellationToken ct)
    {
        var word = await _context.CategoryWords.FirstOrDefaultAsync(w => w.Id == id, ct);
        if (word == null) return NotFound(new { message = "Слово не найдено." });

        // Мягкое удаление. Прогресс пользователей (UserCategoryWordProgress)
        // остаётся: FK стоит на Restrict, и строку никто не уносит.
        word.DeletedAt = DateTime.UtcNow;
        word.DeletedByUserId = AdminId;
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateCategories();
        _logger.LogInformation("Админ {AdminId} удалил слово {Id} (мягко)", AdminId, id);

        return Ok(new { id, deletedAt = word.DeletedAt });
    }

    [HttpPost("words/{id:int}/restore")]
    public async Task<ActionResult<object>> RestoreWord(int id, CancellationToken ct)
    {
        var word = await _context.CategoryWords.FirstOrDefaultAsync(w => w.Id == id, ct);
        if (word == null) return NotFound(new { message = "Слово не найдено." });

        word.DeletedAt = null;
        word.DeletedByUserId = null;
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateCategories();
        _logger.LogInformation("Админ {AdminId} восстановил слово {Id}", AdminId, id);

        return Ok(new { id, restored = true });
    }

    // ─────────────────────────────────────────────────────────────────── книги

    [HttpGet("books")]
    public async Task<ActionResult<object>> ListBooks(
        [FromQuery] bool includeDeleted = false, CancellationToken ct = default)
    {
        var query = _context.Books.AsNoTracking().AsQueryable();
        if (includeDeleted) query = query.IgnoreQueryFilters();

        var books = await query
            .OrderBy(b => b.Id)
            .Select(b => new
            {
                b.Id,
                b.Title,
                b.Author,
                b.CefrLevel,
                b.CoverUrl,
                b.UploadedByUserId,
                b.DeletedAt,
                // null у UploadedByUserId — публичная (гостевая) копия:
                // именно такие книги видит читатель без аккаунта.
                isPublic = b.UploadedByUserId == null
            })
            .ToListAsync(ct);

        return Ok(books);
    }

    /// <summary>
    /// Публикация книги: снимает владельца, чтобы книга попала в гостевой каталог.
    /// Книга пользователя — это его личная копия, витрины она не касается,
    /// поэтому публикация превращает её в публичную.
    /// </summary>
    [HttpPost("books/{id:int}/publish")]
    public async Task<ActionResult<object>> PublishBook(int id, CancellationToken ct)
    {
        var book = await _context.Books.FirstOrDefaultAsync(b => b.Id == id, ct);
        if (book == null) return NotFound(new { message = "Книга не найдена или удалена." });

        if (book.UploadedByUserId == null)
        {
            return Ok(new { id, published = true, alreadyPublic = true });
        }

        book.UploadedByUserId = null;
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateBooks(id);
        _logger.LogInformation("Админ {AdminId} опубликовал книгу {Id}", AdminId, id);

        return Ok(new { id, published = true, alreadyPublic = false });
    }

    [HttpDelete("books/{id:int}")]
    public async Task<ActionResult<object>> DeleteBook(int id, CancellationToken ct)
    {
        var book = await _context.Books.FirstOrDefaultAsync(b => b.Id == id, ct);
        if (book == null) return NotFound(new { message = "Книга не найдена." });

        // Мягкое удаление: EPUB на диске и прогресс читателей остаются.
        // Физическая уборка файлов — отдельная задача, не здесь.
        book.DeletedAt = DateTime.UtcNow;
        book.DeletedByUserId = AdminId;
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateBooks(id);
        _logger.LogInformation("Админ {AdminId} удалил книгу {Id} (мягко)", AdminId, id);

        return Ok(new { id, deletedAt = book.DeletedAt });
    }

    [HttpPost("books/{id:int}/restore")]
    public async Task<ActionResult<object>> RestoreBook(int id, CancellationToken ct)
    {
        var book = await _context.Books.IgnoreQueryFilters().FirstOrDefaultAsync(b => b.Id == id, ct);
        if (book == null) return NotFound(new { message = "Книга не найдена." });

        book.DeletedAt = null;
        book.DeletedByUserId = null;
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateBooks(id);
        _logger.LogInformation("Админ {AdminId} восстановил книгу {Id}", AdminId, id);

        return Ok(new { id, restored = true });
    }

    // ────────────────────────────────────────────────────────────────── helpers

    /// <summary>
    /// Слаг для URL. Кириллица транслитерируется, а не выбрасывается: имя
    /// категории почти всегда русское, и без транслитерации /категории/{slug}
    /// приходит процентно-закодированным — ссылку нельзя ни прочитать, ни
    /// набрать руками.
    /// </summary>
    private static string NormalizeSlug(string? slug, string name)
    {
        var source = string.IsNullOrWhiteSpace(slug) ? name : slug;
        var transliterated = Transliterate(source);

        var normalized = new string(
            transliterated.Trim().ToLowerInvariant()
                .Select(ch => char.IsLetterOrDigit(ch) && ch < 128 ? ch : '-')
                .ToArray());

        while (normalized.Contains("--")) normalized = normalized.Replace("--", "-");

        var trimmed = normalized.Trim('-');

        // Если после чистки не осталось ничего (имя из одних эмодзи), слага
        // не будет — вернуть пустую строку значит получить нарушение NOT NULL
        // и уникального индекса. Подставляем нейтральный префикс + хэш.
        if (trimmed.Length == 0)
        {
            trimmed = "cat-" + Math.Abs(name.GetHashCode()).ToString("x");
        }

        return trimmed;
    }


    private static string Transliterate(string input)
    {
        // Общая реализация живёт в Services.Transliteration: копия здесь
        // разошлась бы с той, что использует контроллер статей, и один и тот
        // же заголовок давал бы разные слаги в двух разделах админки.
        return Services.Transliteration.ToLatin(input);
    }
}

public record CategoryUpsertDto(
    [property: Required, MaxLength(100)] string Name,
    [property: MaxLength(100)] string? Slug,
    [property: MaxLength(20)] string? Icon,
    [property: MaxLength(20)] string? Color,
    [property: MaxLength(500)] string? Description);

public record CategoryWordUpsertDto(
    [property: Required, MaxLength(100)] string English,
    [property: Required, MaxLength(200)] string Translation,
    [property: MaxLength(100)] string? Transcription,
    [property: MaxLength(500)] string? Example);
