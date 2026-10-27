using System.ComponentModel.DataAnnotations;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Новостная лента для читателя.
///
/// Отдаёт то, что человек реально увидит на главной: свежие новости своего
/// уровня и своих интересов. Новости живут отдельно от статей и не имеют
/// своего пункта в меню — блок есть на главной, пока есть что показать.
/// </summary>
[ApiController]
[Route("api/news")]
public class NewsController : ControllerBase
{
    /// <summary>
    /// Потолок карточки на главной. Ограничение на сервере, а не в вёрстке:
    /// клиент может попросить больше, но получит не больше пяти — иначе
    /// главная превращается в ленту, а решение об этом не должно зависеть от
    /// того, какой фронтенд сегодня развёрнут.
    /// </summary>
    private const int MaxFeedSize = 5;

    private readonly ApplicationDbContext _context;

    public NewsController(ApplicationDbContext context)
    {
        _context = context;
    }

    /// <summary>
    /// Персональная выдача. Анонимный запрос тоже работает — тогда фильтра по
    /// интересам нет, но уровень остаётся единственным ориентиром, который у
    /// нас есть. Это лучше, чем пустота для гостя.
    /// </summary>
    [HttpGet("for-me")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<ActionResult<object>> ForMe(
        [FromQuery] string? level = null,
        [FromQuery] int? take = null,
        CancellationToken ct = default)
    {
        var limit = Math.Clamp(take ?? MaxFeedSize, 1, MaxFeedSize);
        var userId = User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        // Интересы есть только у вошедшего.
        var interests = string.IsNullOrEmpty(userId)
            ? Array.Empty<string>()
            : await _context.UserInterests
                .AsNoTracking()
                .Where(i => i.UserId == userId)
                .Select(i => i.Interest)
                .ToArrayAsync(ct);

        var query = _context.NewsItems
            .AsNoTracking()
            .Where(n => !n.IsHidden);

        // Уровень: только точное совпадение. Показать C1 первогодке хуже, чем
        // не показать ничего — текст, который невозможно прочитать, отбивает
        // желание заходить. Новости без уровня остаются в общем списке, но не
        // в персональной выдаче.
        if (!string.IsNullOrWhiteSpace(level))
        {
            var normalized = level.Trim().ToUpperInvariant();
            query = query.Where(n => n.Level == normalized);
        }

        var candidates = await query
            .OrderByDescending(n => n.PublishedAt)
            .Take(limit * 4)  // запас под фильтр по интересам
            .Select(n => new
            {
                n.Id,
                n.Title,
                n.Summary,
                n.SourceName,
                n.SourceUrl,
                n.ImageUrl,
                n.Level,
                n.Topics,
                n.PublishedAt
            })
            .ToListAsync(ct);

        // Интересы фильтруют, но не отсекают всё: если у человека нет ни одной
        // подходящей новости, он получит общую ленту, а не пустой экран. Фильтр
        // меняет приоритет, а не превращается в запрет.
        var matched = interests.Length == 0
            ? candidates
            : candidates
                .Where(n => MatchesAnyInterest(n.Topics, interests))
                .Concat(candidates.Where(n => !MatchesAnyInterest(n.Topics, interests)))
                .ToList();

        var items = matched
            .Take(limit)
            .Select(n => new
            {
                n.Id,
                n.Title,
                n.Summary,
                n.SourceName,
                n.SourceUrl,
                n.ImageUrl,
                n.Level,
                topics = SplitTopics(n.Topics),
                n.PublishedAt
            })
            .ToList();

        return Ok(new
        {
            items,
            // Фронт решает по этому флагу, рисовать ли блок вообще.
            hasMore = matched.Count > items.Count,
            interestsApplied = interests.Length > 0
        });
    }

    private static bool MatchesAnyInterest(string topics, string[] interests)
    {
        var mine = SplitTopics(topics);
        return interests.Any(i => mine.Contains(i, StringComparer.Ordinal));
    }

    private static string[] SplitTopics(string topics) =>
        string.IsNullOrWhiteSpace(topics)
            ? Array.Empty<string>()
            : topics.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}

/// <summary>
/// Интересы пользователя: выбор в онбординге и в настройках.
/// </summary>
[ApiController]
[Route("api/interests")]
[Authorize]
public class InterestsController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public InterestsController(ApplicationDbContext context)
    {
        _context = context;
    }

    private string UserId =>
        User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value!;

    /// <summary>Справочник для интерфейса: что вообще можно выбрать.</summary>
    [HttpGet("catalog")]
    public ActionResult<object> Catalog() =>
        Ok(Interests.All.Select(kv => new { key = kv.Key, label = kv.Value }));

    /// <summary>Мои интересы — ключами, как они лежат в фильтре.</summary>
    [HttpGet]
    public async Task<ActionResult<object>> Mine(CancellationToken ct)
    {
        var userId = UserId;
        var mine = await _context.UserInterests
            .AsNoTracking()
            .Where(i => i.UserId == userId)
            .Select(i => i.Interest)
            .ToListAsync(ct);

        return Ok(new { interests = mine });
    }

    /// <summary>
    /// Заменить набор целиком.
    ///
    /// Именно замена, а не «добавить»: экран онбординга показывает галочки, и
    /// снятая галочка должна исчезнуть из базы. Клиент присылает итоговое
    /// состояние, сервер его фиксирует.
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<object>> Replace([FromBody] InterestsDto dto, CancellationToken ct)
    {
        var userId = UserId;

        var requested = (dto.Interests ?? Array.Empty<string>())
            .Select(i => i?.Trim().ToLowerInvariant())
            .Where(i => !string.IsNullOrEmpty(i))
            .Distinct()
            .ToList();

        var unknown = requested.Where(i => !Interests.IsValid(i)).ToList();
        if (unknown.Count > 0)
        {
            // Молча отбрасывать нельзя: клиент с опечаткой никогда не узнает,
            // почему фильтр не работает.
            return BadRequest(new { message = $"Неизвестные интересы: {string.Join(", ", unknown)}" });
        }

        var existing = await _context.UserInterests
            .Where(i => i.UserId == userId)
            .ToListAsync(ct);

        var toRemove = existing.Where(e => !requested.Contains(e.Interest)).ToList();
        if (toRemove.Count > 0) _context.UserInterests.RemoveRange(toRemove);

        var existingKeys = existing.Select(e => e.Interest).ToHashSet(StringComparer.Ordinal);
        foreach (var interest in requested.Where(i => !existingKeys.Contains(i)))
        {
            _context.UserInterests.Add(new UserInterest
            {
                UserId = userId,
                Interest = interest,
                UpdatedAt = DateTime.UtcNow
            });
        }

        await _context.SaveChangesAsync(ct);

        return Ok(new { interests = requested });
    }
}

public record InterestsDto(string[]? Interests);
