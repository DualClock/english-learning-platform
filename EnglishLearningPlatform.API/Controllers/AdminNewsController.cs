using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Security;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.News;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Админское управление новостной лентой.
///
/// У новостей нет CRUD в привычном смысле: их не пишут руками, они приезжают
/// из фидов. Поэтому вместо создания и правки — управление тем, что уже
/// пришло:
///
///  1. Показать (с пагинацией) — чтобы видеть, что вообще лежит в базе.
///  2. Скрыть / показать — единственная «правка»: новость остаётся строкой,
///     даже скрытая. Удалить её значит забыть про ExternalId, и следующий
///     опрос принесёт тот же материал снова.
///  3. Обновить сейчас — ручной проход фетчера, не дожидаясь таймера. Вызывает
///     ровно тот сервис, что и фоновый цикл: два разных пути к одной базе
///     рано или поздно разойдутся в поведении.
///  4. Убрать старое — ручная уборка на случай, если меняли RetentionDays.
///
/// Всё пишущее сбрасывает кэши витрины (ContentCacheInvalidator): иначе админ
/// спрятал новость, а человек видит её ещё шесть часов.
/// </summary>
[ApiController]
[Route("api/admin/news")]
[Authorize(Roles = AppRoles.Admin)]
[EnableRateLimiting("admin")]
public class AdminNewsController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly NewsFetchService _fetcher;
    private readonly NewsCleanupService _cleanup;
    private readonly ContentCacheInvalidator _cache;
    private readonly ILogger<AdminNewsController> _logger;

    public AdminNewsController(
        ApplicationDbContext context,
        NewsFetchService fetcher,
        NewsCleanupService cleanup,
        ContentCacheInvalidator cache,
        ILogger<AdminNewsController> logger)
    {
        _context = context;
        _fetcher = fetcher;
        _cleanup = cleanup;
        _cache = cache;
        _logger = logger;
    }

    // Claims читаются через `User?`: контроллер обязан работать и там, где
    // HttpContext нет (юнит-тесты), иначе AdminId — NullReferenceException.
    private string AdminId =>
        User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "admin";

    /// <summary>
    /// Список новостей: всё, включая скрытые — админка единственное место, где
    /// скрытое надо видеть, иначе показать его обратно нечем.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<object>> List(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] bool? hidden = null,
        CancellationToken ct = default)
    {
        // Верхняя граница размера страницы: админ может передать 100000 и
        // вытащить всю таблицу одним запросом, что на бете закончится
        // таймаутом и отвалившимся health-check.
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _context.NewsItems.AsNoTracking().AsQueryable();

        if (hidden is { } onlyHidden)
        {
            query = query.Where(n => n.IsHidden == onlyHidden);
        }

        var total = await query.CountAsync(ct);

        var items = await query
            .OrderByDescending(n => n.PublishedAt)
            .ThenByDescending(n => n.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(n => new
            {
                n.Id,
                n.ExternalId,
                n.Title,
                n.Summary,
                n.SourceName,
                n.SourceUrl,
                n.ImageUrl,
                n.Level,
                n.Topics,
                n.PublishedAt,
                n.FetchedAt,
                n.IsHidden
            })
            .ToListAsync(ct);

        return Ok(new
        {
            page,
            pageSize,
            total,
            totalPages = (int)Math.Ceiling(total / (double)pageSize),
            items
        });
    }

    /// <summary>Спрятать новость с витрины. Строка остаётся: дедупликация должна её помнить.</summary>
    [HttpPost("{id:int}/hide")]
    public async Task<ActionResult<object>> Hide(int id, CancellationToken ct)
    {
        var item = await _context.NewsItems.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (item == null) return NotFound(new { message = "Новость не найдена." });

        if (item.IsHidden) return Ok(new { id, hidden = true, changed = false });

        item.IsHidden = true;
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateCategories();
        _logger.LogInformation("Админ {AdminId} скрыл новость {Id}", AdminId, id);

        return Ok(new { id, hidden = true, changed = true });
    }

    /// <summary>Вернуть новость на витрину.</summary>
    [HttpPost("{id:int}/show")]
    public async Task<ActionResult<object>> Show(int id, CancellationToken ct)
    {
        var item = await _context.NewsItems.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (item == null) return NotFound(new { message = "Новость не найдена." });

        if (!item.IsHidden) return Ok(new { id, hidden = false, changed = false });

        item.IsHidden = false;
        await _context.SaveChangesAsync(ct);

        _cache.InvalidateCategories();
        _logger.LogInformation("Админ {AdminId} показал новость {Id}", AdminId, id);

        return Ok(new { id, hidden = false, changed = true });
    }

    /// <summary>
    /// Ручной проход фетчера: не ждать двухчасового таймера.
    ///
    /// Возвращает добавленное/обновлённое и список источников, которые не
    /// ответили. Текст исключения наружу не отдаём — он из чужого фида и
    /// админу ничего не говорит.
    /// </summary>
    [HttpPost("refresh")]
    public async Task<ActionResult<object>> Refresh(CancellationToken ct)
    {
        var report = await _fetcher.FetchAllAsync(ct);

        if (report.Added > 0 || report.Updated > 0)
        {
            _cache.InvalidateCategories();
        }

        _logger.LogInformation(
            "Админ {AdminId} запустил обновление новостей: +{Added}, ~{Updated}, сбоев {Failures}",
            AdminId, report.Added, report.Updated, report.Failures.Count);

        return Ok(new
        {
            added = report.Added,
            updated = report.Updated,
            skipped = report.Skipped,
            failures = report.Failures
        });
    }

    /// <summary>
    /// Ручная уборка старых новостей. Нужна после смены News:RetentionDays —
    /// иначе новый порог заработает только на следующем фоновом проходе.
    /// </summary>
    [HttpPost("cleanup")]
    public async Task<ActionResult<object>> Cleanup(CancellationToken ct)
    {
        var deleted = await _cleanup.RunOnceAsync(ct);

        if (deleted > 0)
        {
            _cache.InvalidateCategories();
        }

        _logger.LogInformation(
            "Админ {AdminId} запустил уборку новостей: удалено {Count}", AdminId, deleted);

        return Ok(new { deleted, retentionDays = _cleanup.RetentionDays });
    }
}
