using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

public class AnalyticsEventDto
{
    [MaxLength(50)]
    public string Event { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Meta { get; set; }
}

[ApiController]
[Route("api/analytics")]
[Authorize]
public class AnalyticsController : ControllerBase
{
    private static readonly HashSet<string> AllowedEvents = new(StringComparer.OrdinalIgnoreCase)
    {
        "login", "register", "book_opened", "page_read", "word_translated",
        "word_learned", "word_reviewed", "session_finished", "lesson_completed",
        "grammar_unit_completed", "practice_finished", "chat_message"
    };

    private readonly ApplicationDbContext _context;
    private readonly ILogger<AnalyticsController> _logger;
    private readonly IConfiguration _configuration;
    private readonly IWebHostEnvironment _environment;

    public AnalyticsController(
        ApplicationDbContext context,
        ILogger<AnalyticsController> logger,
        IConfiguration configuration,
        IWebHostEnvironment environment)
    {
        _context = context;
        _logger = logger;
        _configuration = configuration;
        _environment = environment;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // POST: api/analytics/event
    [HttpPost("event")]
    public async Task<IActionResult> Track([FromBody] AnalyticsEventDto dto)
    {
        if (!AllowedEvents.Contains(dto.Event))
        {
            return BadRequest(new { message = "Unknown event" });
        }

        try
        {
            _context.AnalyticsEvents.Add(new AnalyticsEvent
            {
                UserId = GetUserId(),
                Event = dto.Event.ToLowerInvariant(),
                Meta = dto.Meta is { Length: > 500 } ? dto.Meta[..500] : dto.Meta
            });
            await _context.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // Аналитика никогда не должна ломать пользовательский сценарий
            _logger.LogWarning(ex, "Analytics tracking failed");
        }

        return Ok();
    }

    public record EventCount(string Event, int Count);
    public record DailyActive(DateTime Date, int Users);

    // GET: api/analytics/summary — сводка по проекту (для владельца)
    [HttpGet("summary")]
    [EnableRateLimiting("admin")]
    public async Task<IActionResult> Summary([FromHeader(Name = "X-Seed-Key")] string? seedKey)
    {
        // Сводка — бизнес-метрики всего проекта, а не данные пользователя:
        // обычный JWT здесь недостаточен, нужен административный ключ.
        var configuredKey = _configuration["Seeder:Key"];
        if (!AdminKeyGuard.IsAuthorized(seedKey, configuredKey, _environment.IsDevelopment()))
        {
            if (string.IsNullOrEmpty(configuredKey)) return Forbid();
            return Unauthorized(new { message = "Invalid admin key" });
        }

        var since = DateTime.UtcNow.AddDays(-30);

        // Для беты агрегируем в памяти: объёмы малы, зато нет проблем с трансляцией LINQ
        var events = await _context.AnalyticsEvents
            .Where(ae => ae.CreatedAt >= since)
            .Select(ae => new { ae.Event, ae.UserId, ae.CreatedAt })
            .ToListAsync();

        var byEvent = events
            .GroupBy(ae => ae.Event)
            .Select(g => new { Event = g.Key, Count = g.Count() })
            .OrderByDescending(g => g.Count)
            .ToList();

        var dau = events
            .GroupBy(ae => ae.CreatedAt.Date)
            .Select(g => new { Date = g.Key, Users = g.Select(x => x.UserId).Distinct().Count() })
            .OrderBy(g => g.Date)
            .ToList();

        var activeUsers = events.Select(ae => ae.UserId).Distinct().Count();

        return Ok(new
        {
            activeUsersLast30Days = activeUsers,
            eventsLast30Days = byEvent,
            dailyActiveUsers = dau.Select(d => new { date = d.Date.ToString("yyyy-MM-dd"), users = d.Users })
        });
    }
}
