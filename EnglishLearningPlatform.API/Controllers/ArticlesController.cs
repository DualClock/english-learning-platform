using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services.Articles;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Статьи: публичное чтение и админское управление в одном контроллере.
///
/// Почему не два контроллера: публичные и админские методы делят одну
/// проекцию статьи, и расхождение между ними — это когда админ видит в
/// редакторе одно, а читатель другое. Разделение по атрибутам на методах,
/// а не по файлам, держит проекцию в одном месте.
/// </summary>
[ApiController]
[Route("api/articles")]
public class ArticlesController : ControllerBase
{
    /// <summary>
    /// Потолок страницы. Держим на сервере: ограничение в вёрстке не защита —
    /// другой клиент попросит тысячу и превратит список в выгрузку всей базы.
    /// </summary>
    private const int MaxPageSize = 50;

    private const int DefaultPageSize = 20;

    private readonly ApplicationDbContext _context;
    private readonly MarkdownRenderer _renderer;

    public ArticlesController(ApplicationDbContext context, MarkdownRenderer renderer)
    {
        _context = context;
        _renderer = renderer;
    }

    // ── Публичное чтение ────────────────────────────────────────────────

    /// <summary>
    /// Список опубликованных статей. `section` — слаг раздела.
    /// </summary>
    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> List(
        [FromQuery] string? section,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = DefaultPageSize,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        // Фильтр по статусу обязателен на публичном маршруте: черновик — это
        // не «флаг для UI», а текст, которого ещё нет. Без него редактор
        // увидел бы свою же недописанную статью на сайте.
        var query = _context.Articles
            .AsNoTracking()
            .Where(a => a.Status == ArticleStatus.Published && a.DeletedAt == null);

        if (!string.IsNullOrWhiteSpace(section))
        {
            var slug = section.Trim().ToLowerInvariant();
            query = query.Where(a => a.Section != null && a.Section.Slug == slug);
        }

        var total = await query.CountAsync(ct);

        var rows = await query
            .OrderByDescending(a => a.PublishedAt ?? a.CreatedAt)
            .ThenByDescending(a => a.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new
            {
                a.Id,
                a.Slug,
                a.Title,
                a.Summary,
                a.BodyMarkdown,
                a.PublishedAt,
                SectionName = a.Section != null ? a.Section.Name : null,
                SectionSlug = a.Section != null ? a.Section.Slug : null,
            })
            .ToListAsync(ct);

        var items = rows.Select(a => new
        {
            a.Id,
            a.Slug,
            a.Title,
            Summary = _renderer.BuildSummary(a.Summary, a.BodyMarkdown, 200),
            PublishedAt = a.PublishedAt,
            a.SectionName,
            a.SectionSlug,
        }).ToList();

        return Ok(new { items, total, page, pageSize });
    }

    /// <summary>
    /// Одна статья по слагу. Черновик и архив отдают 404.
    /// </summary>
    [HttpGet("{slug}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetBySlug(string slug, CancellationToken ct = default)
    {
        var normalized = (slug ?? string.Empty).Trim().ToLowerInvariant();

        var article = await _context.Articles
            .AsNoTracking()
            .Include(a => a.Section)
            .Where(a => a.Slug == normalized
                        && a.Status == ArticleStatus.Published
                        && a.DeletedAt == null)
            .Select(a => new
            {
                a.Id,
                a.Slug,
                a.Title,
                a.Summary,
                a.BodyMarkdown,
                a.BodyHtml,
                a.PublishedAt,
                a.UpdatedAt,
                SectionName = a.Section != null ? a.Section.Name : null,
                SectionSlug = a.Section != null ? a.Section.Slug : null,
            })
            .FirstOrDefaultAsync(ct);

        if (article == null) return NotFound();

        return Ok(new
        {
            article.Id,
            article.Slug,
            article.Title,
            Summary = _renderer.BuildSummary(article.Summary, article.BodyMarkdown),
            article.BodyHtml,
            article.PublishedAt,
            article.UpdatedAt,
            article.SectionName,
            article.SectionSlug,
        });
    }

    /// <summary>Разделы для навигации: только непустые и неудалённые.</summary>
    [HttpGet("sections")]
    [AllowAnonymous]
    public async Task<IActionResult> Sections(CancellationToken ct = default)
    {
        var items = await _context.ArticleSections
            .AsNoTracking()
            .Where(s => s.DeletedAt == null)
            .OrderBy(s => s.SortOrder)
            .ThenBy(s => s.Name)
            .Select(s => new { s.Id, s.Name, s.Slug, s.Description, s.SortOrder })
            .ToListAsync(ct);

        return Ok(new { items });
    }

    // ── Админка ─────────────────────────────────────────────────────────

    /// <summary>Все статьи, включая черновики и архив.</summary>
    [HttpGet("admin")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> AdminList(
        [FromQuery] string? status,
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = DefaultPageSize,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _context.Articles.AsNoTracking().Where(a => a.DeletedAt == null);

        if (!string.IsNullOrWhiteSpace(status))
        {
            // Невалидный статус — пустая выдача, а не молчаливое «показать
            // всё»: иначе опечатка в фильтре выглядит как баг данных.
            if (!ArticleStatus.IsValid(status)) return Ok(new { items = Array.Empty<object>(), total = 0 });
            query = query.Where(a => a.Status == status);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = search.Trim().ToLowerInvariant();
            query = query.Where(a => a.Title.ToLower().Contains(pattern) || a.Slug.Contains(pattern));
        }

        var total = await query.CountAsync(ct);

        var items = await query
            .OrderByDescending(a => a.UpdatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new
            {
                a.Id,
                a.Slug,
                a.Title,
                a.Status,
                a.SectionId,
                SectionName = a.Section != null ? a.Section.Name : null,
                a.PublishedAt,
                a.CreatedAt,
                a.UpdatedAt,
            })
            .ToListAsync(ct);

        return Ok(new { items, total, page, pageSize });
    }

    /// <summary>Полная статья для редактора: markdown, а не HTML.</summary>
    [HttpGet("admin/{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> AdminGet(int id, CancellationToken ct = default)
    {
        var article = await _context.Articles
            .AsNoTracking()
            .Where(a => a.Id == id && a.DeletedAt == null)
            .Select(a => new
            {
                a.Id,
                a.Slug,
                a.Title,
                a.Summary,
                a.BodyMarkdown,
                a.Status,
                a.SectionId,
                a.PublishedAt,
                a.CreatedAt,
                a.UpdatedAt,
                RevisionCount = a.Revisions.Count,
            })
            .FirstOrDefaultAsync(ct);

        if (article == null) return NotFound();
        return Ok(article);
    }

    /// <summary>Создать статью. Всегда черновиком.</summary>
    [HttpPost("admin")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] ArticleRequest request, CancellationToken ct = default)
    {
        var error = Validate(request);
        if (error != null) return BadRequest(new { error });

        var slug = NormalizeSlug(request.Slug, request.Title);

        if (await _context.Articles.AnyAsync(a => a.Slug == slug && a.DeletedAt == null, ct))
            return Conflict(new { error = $"Слаг «{slug}» уже занят" });

        if (request.SectionId is int sectionId
            && !await _context.ArticleSections.AnyAsync(s => s.Id == sectionId && s.DeletedAt == null, ct))
            return BadRequest(new { error = "Раздел не найден" });

        var now = DateTime.UtcNow;
        var article = new Article
        {
            Slug = slug,
            Title = request.Title!.Trim(),
            Summary = string.IsNullOrWhiteSpace(request.Summary) ? null : request.Summary!.Trim(),
            BodyMarkdown = request.BodyMarkdown ?? string.Empty,
            BodyHtml = _renderer.Render(request.BodyMarkdown),
            SectionId = request.SectionId,
            // Новая статья всегда черновиком, даже если в запросе просят
            // published: публикация — отдельное действие с проверкой, что
            // текст вообще есть. Иначе «создать и опубликовать одним POST»
            // выпускает пустую страницу на сайт.
            Status = ArticleStatus.Draft,
            AuthorId = CurrentUserId,
            CreatedAt = now,
            UpdatedAt = now,
        };

        _context.Articles.Add(article);
        await _context.SaveChangesAsync(ct);

        return Ok(new { article.Id, article.Slug, article.Status });
    }

    /// <summary>Правка статьи. Публикация — отдельным методом.</summary>
    [HttpPut("admin/{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] ArticleRequest request, CancellationToken ct = default)
    {
        var error = Validate(request);
        if (error != null) return BadRequest(new { error });

        var article = await _context.Articles.FirstOrDefaultAsync(a => a.Id == id && a.DeletedAt == null, ct);
        if (article == null) return NotFound();

        var slug = NormalizeSlug(request.Slug ?? article.Slug, request.Title);

        if (await _context.Articles.AnyAsync(a => a.Slug == slug && a.Id != id && a.DeletedAt == null, ct))
            return Conflict(new { error = $"Слаг «{slug}» уже занят" });

        if (request.SectionId is int sectionId
            && !await _context.ArticleSections.AnyAsync(s => s.Id == sectionId && s.DeletedAt == null, ct))
            return BadRequest(new { error = "Раздел не найден" });

        // Снимок ДО правки: иначе «админ случайно затёр текст» — это потеря
        // контента без возможности откатиться, и вопрос «что было раньше»
        // станет неотвечаемым.
        var lastRevision = await _context.ArticleRevisions
            .Where(r => r.ArticleId == id)
            .MaxAsync(r => (int?)r.Revision, ct) ?? 0;

        _context.ArticleRevisions.Add(new ArticleRevision
        {
            ArticleId = article.Id,
            Revision = lastRevision + 1,
            Title = article.Title,
            BodyMarkdown = article.BodyMarkdown,
            Status = article.Status,
            EditedByUserId = CurrentUserId,
            CreatedAt = DateTime.UtcNow,
        });

        article.Title = request.Title!.Trim();
        article.Slug = slug;
        article.Summary = string.IsNullOrWhiteSpace(request.Summary) ? null : request.Summary!.Trim();
        article.BodyMarkdown = request.BodyMarkdown ?? string.Empty;
        article.BodyHtml = _renderer.Render(request.BodyMarkdown);
        article.SectionId = request.SectionId;
        article.UpdatedAt = DateTime.UtcNow;

        // Статус НЕ меняем здесь: снять с публикации или выпустить заново —
        // это Publish/Archive. Иначе правка опечатки в опубликованной статье
        // требовала бы заново её публиковать.
        await _context.SaveChangesAsync(ct);

        return Ok(new { article.Id, article.Slug, article.Status, article.UpdatedAt });
    }

    /// <summary>Опубликовать. Пустую статью выпустить нельзя.</summary>
    [HttpPost("admin/{id:int}/publish")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Publish(int id, CancellationToken ct = default)
    {
        var article = await _context.Articles.FirstOrDefaultAsync(a => a.Id == id && a.DeletedAt == null, ct);
        if (article == null) return NotFound();

        if (string.IsNullOrWhiteSpace(article.BodyMarkdown))
            return BadRequest(new { error = "Нельзя опубликовать статью без текста" });

        // PublishedAt ставим только при первой публикации: переопубликация
        // старой статьи не делает её новой, иначе она всплывает в списке
        // наверх и вытесняет свежее.
        article.PublishedAt ??= DateTime.UtcNow;
        article.Status = ArticleStatus.Published;
        article.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync(ct);
        return Ok(new { article.Id, article.Status, article.PublishedAt });
    }

    /// <summary>Снять с публикации. Ссылки продолжают работать — 404 у читателя.</summary>
    [HttpPost("admin/{id:int}/archive")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Archive(int id, CancellationToken ct = default)
    {
        var article = await _context.Articles.FirstOrDefaultAsync(a => a.Id == id && a.DeletedAt == null, ct);
        if (article == null) return NotFound();

        article.Status = ArticleStatus.Archived;
        article.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync(ct);
        return Ok(new { article.Id, article.Status });
    }

    /// <summary>Удалить (мягко: строки остаются, ревизии сохраняются).</summary>
    [HttpDelete("admin/{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct = default)
    {
        var article = await _context.Articles.FirstOrDefaultAsync(a => a.Id == id && a.DeletedAt == null, ct);
        if (article == null) return NotFound();

        // Физическое удаление запрещено архитектурой: на статью могут вести
        // внешние ссылки, а ревизии — единственный способ восстановить текст.
        article.DeletedAt = DateTime.UtcNow;
        article.DeletedByUserId = CurrentUserId;

        await _context.SaveChangesAsync(ct);
        return Ok(new { article.Id, deleted = true });
    }

    /// <summary>Восстановить удалённую статью (слаг мог освободиться — проверим).</summary>
    [HttpPost("admin/{id:int}/restore")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Restore(int id, CancellationToken ct = default)
    {
        // IgnoreQueryFilters: по умолчанию удалённые скрыты и найти их нельзя.
        var article = await _context.Articles
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(a => a.Id == id, ct);

        if (article == null) return NotFound();
        if (article.DeletedAt == null) return Ok(new { article.Id, restored = false });

        if (await _context.Articles.AnyAsync(a => a.Slug == article.Slug && a.Id != id && a.DeletedAt == null, ct))
            return Conflict(new { error = $"Слаг «{article.Slug}» уже занят другой статьёй" });

        article.DeletedAt = null;
        article.DeletedByUserId = null;
        article.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync(ct);
        return Ok(new { article.Id, restored = true });
    }

    // ── Служебное ───────────────────────────────────────────────────────

    private string? CurrentUserId => User.FindFirstValue(ClaimTypes.NameIdentifier);

    private static string? Validate(ArticleRequest request)
    {
        if (request == null) return "Пустой запрос";
        if (string.IsNullOrWhiteSpace(request.Title)) return "Заголовок обязателен";
        if (request.Title.Trim().Length > 300) return "Заголовок длиннее 300 символов";
        if (request.Summary is { Length: > 1000 }) return "Анонс длиннее 1000 символов";
        return null;
    }

    /// <summary>
    /// Слаг из явного значения или из заголовка. Кириллица транслитерируется:
    /// раньше «проверка» превращалась в пустую строку, и все такие статьи
    /// конфликтовали между собой по пустому слагу.
    /// </summary>
    private static string NormalizeSlug(string? explicitSlug, string? title)
    {
        var source = !string.IsNullOrWhiteSpace(explicitSlug) ? explicitSlug : title;
        var slug = Slugify(source ?? string.Empty);

        if (slug.Length > 0) return slug;

        // Заголовок без единой латинской буквы и цифры — слаг из хеша:
        // предсказуемый, уникальный, без пустой строки.
        var hash = Convert.ToHexString(
            System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(title ?? string.Empty)))[..8].ToLowerInvariant();

        return "article-" + hash;
    }

    internal static string Slugify(string value)
    {
        var transliterated = Services.Transliteration.ToLatin(value);
        var builder = new System.Text.StringBuilder(transliterated.Length);

        foreach (var ch in transliterated.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch) && ch < 128) builder.Append(ch);
            else if (ch is ' ' or '-' or '_' or '/') builder.Append('-');
        }

        var slug = builder.ToString();
        while (slug.Contains("--")) slug = slug.Replace("--", "-");
        return slug.Trim('-');
    }

    public sealed class ArticleRequest
    {
        public string? Slug { get; set; }

        [Required]
        public string? Title { get; set; }

        public string? Summary { get; set; }

        public string? BodyMarkdown { get; set; }

        public int? SectionId { get; set; }
    }
}
