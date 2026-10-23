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
        "grammar_unit_completed", "practice_finished", "chat_message",
        FirstChapterEvent
    };

    /// <summary>
    /// Активационное событие: первая открытая глава. Пишется ровно один раз на
    /// пользователя и именно по нему видно, что регистрация превратилась в чтение.
    /// </summary>
    public const string FirstChapterEvent = "chapter_opened_first";

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
    [EnableRateLimiting("analytics")]
    public async Task<IActionResult> Track([FromBody] AnalyticsEventDto dto)
    {
        if (!AllowedEvents.Contains(dto.Event))
        {
            return BadRequest(new { message = "Unknown event" });
        }

        try
        {
            var userId = GetUserId();

            // Активационное событие однократное: клиент может прислать его
            // повторно (перемонтировалась читалка, повторная отправка после
            // обрыва сети), а метрика «начал читать» живёт до тех пор, пока
            // считает ровно один раз на человека. Ответ всё равно 200 —
            // аналитика не должна подсказывать фронтенду, что «что-то не так».
            if (string.Equals(dto.Event, FirstChapterEvent, StringComparison.OrdinalIgnoreCase) &&
                await _context.AnalyticsEvents.AnyAsync(ae =>
                    ae.UserId == userId && ae.Event == FirstChapterEvent))
            {
                return Ok();
            }

            _context.AnalyticsEvents.Add(new AnalyticsEvent
            {
                UserId = userId,
                Event = dto.Event.ToLowerInvariant(),
                Meta = dto.Meta is { Length: > 500 } ? dto.Meta[..500] : dto.Meta
            });
            await _context.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // Аналитика никогда не должна ломать пользовательский сценарий.
            // Сюда же попадает гонка двух параллельных chapter_opened_first:
            // частичный уникальный индекс не впустит вторую строку, и это молча игнорируется.
            _logger.LogWarning(ex, "Analytics tracking failed");
        }

        return Ok();
    }

    public record EventCount(string Event, int Count);
    public record DailyActive(DateTime Date, int Users);

    /// <summary>Регистрация дня: день × канал × код — сколько привели и сколько из них начали читать.</summary>
    public sealed record AcquisitionRow(string Date, string? Source, string? Code, int Registrations, int Activated);

    /// <summary>Тот же срез, но за весь выбранный период и без разбиения по дням.</summary>
    public sealed record AcquisitionChannel(string? Source, int Registrations, int Activated);

    public sealed record AcquisitionTotals(int Registrations, int Activated);

    public sealed record AcquisitionReport(
        int Days,
        string Since,
        AcquisitionRow[] Rows,
        AcquisitionChannel[] ByChannel,
        AcquisitionTotals Totals);

    public const int DefaultAcquisitionDays = 14;
    private const int MinAcquisitionDays = 1;
    private const int MaxAcquisitionDays = 90;

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

    // GET: api/analytics/acquisition?days=14 — сколько регистраций дал каждый канал
    // и сколько из этих людей действительно открыли первую главу
    [HttpGet("acquisition")]
    [EnableRateLimiting("admin")]
    public async Task<IActionResult> Acquisition(
        [FromHeader(Name = "X-Seed-Key")] string? seedKey,
        [FromQuery] int days = DefaultAcquisitionDays)
    {
        // Тот же контур доступа, что у /summary: чужие коды каналов и воронка
        // проекта — не то, что должен видеть любой вошедший пользователь.
        var configuredKey = _configuration["Seeder:Key"];
        if (!AdminKeyGuard.IsAuthorized(seedKey, configuredKey, _environment.IsDevelopment()))
        {
            if (string.IsNullOrEmpty(configuredKey)) return Forbid();
            return Unauthorized(new { message = "Invalid admin key" });
        }

        // Окно ограничиваем: days=0 или days=100000 означали бы «пробеги по всей
        // таблице» на каждом запросе, а выгрузка предназначена для живого чтения.
        days = Math.Clamp(days, MinAcquisitionDays, MaxAcquisitionDays);
        var since = DateTime.UtcNow.AddDays(-days);

        var registrants = await _context.Users
            .Where(u => u.CreatedAt >= since)
            .Select(u => new { u.Id, u.CreatedAt, u.AcquisitionSource, u.AcquisitionCode })
            .ToListAsync();

        var registrantIds = registrants.Select(r => r.Id).ToArray();

        // Активация — «этот человек открыл первую главу когда-либо», поэтому берём
        // distinct по пользователям, а не количество событий: исторические дубли
        // не должны превращать одного читателя в двух.
        var activatedIds = new HashSet<string>(
            await _context.AnalyticsEvents
                .Where(ae => ae.Event == FirstChapterEvent && registrantIds.Contains(ae.UserId))
                .Select(ae => ae.UserId)
                .Distinct()
                .ToListAsync(),
            StringComparer.Ordinal);

        // Агрегация в памяти, как в /summary: за бету строк десятки, а группировка
        // по LocalTime-усечённой дате в LINQ к Npgsql переводится болезненно.
        var rows = registrants
            .GroupBy(r => new { Date = r.CreatedAt.Date, r.AcquisitionSource, r.AcquisitionCode })
            .Select(g => new AcquisitionRow(
                g.Key.Date.ToString("yyyy-MM-dd"),
                g.Key.AcquisitionSource,
                g.Key.AcquisitionCode,
                g.Count(),
                g.Count(r => activatedIds.Contains(r.Id))))
            .OrderBy(r => r.Date)
            .ThenByDescending(r => r.Registrations)
            .ToArray();

        var byChannel = registrants
            .GroupBy(r => r.AcquisitionSource)
            .Select(g => new AcquisitionChannel(
                g.Key,
                g.Count(),
                g.Count(r => activatedIds.Contains(r.Id))))
            .OrderByDescending(c => c.Registrations)
            .ToArray();

        return Ok(new AcquisitionReport(
            days,
            since.ToString("yyyy-MM-dd"),
            rows,
            byChannel,
            new AcquisitionTotals(
                registrants.Count,
                registrants.Count(r => activatedIds.Contains(r.Id)))));
    }
}
