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
    /// <summary>
    /// События аутентифицированного пути. Публично — чтобы тест сверял два
    /// набора событий (здесь и в AnonymousAnalyticsController) и не давал
    /// гостевым именам утечь в прод-аналитику читателя, а читательским — в
    /// анонимный write-путь.
    /// </summary>
    public static readonly IReadOnlySet<string> AllowedEvents = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
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

    /// <summary>
    /// Верх воронки за день: то, что видит менеджер одним взглядом — сколько
    /// гостей открыли тест, сколько дошли до результата, сколько зарегистрировалось
    /// и сколько из них открыло первую главу.
    ///
    /// Гостевые колонки считаются по проходам /test (у гостя нет аккаунта, по
    /// которому можно было бы построить когорту), регистрационные — по когорте
    /// этого дня, ровно как в <see cref="AcquisitionRow"/>. Числа `rows` и `funnel`
    /// сходятся: funnel — это сумма строк дня по всем каналам плюс гостевые события.
    /// </summary>
    public sealed record FunnelRow(
        string Date,
        int GuestStarts,
        int GuestCompletions,
        int GuestVisitors,
        int Registrations,
        int Activated);

    /// <summary>Распределение гостевых результатов по уровням — зачем человек пришёл и что ему предлагать дальше.</summary>
    public sealed record GuestLevelRow(string Level, int Completions);

    /// <summary>Гостевые итоги за окно. `Visitors` — разных хешей IP, а не людей: семья за одним NAT = один гость.</summary>
    public sealed record GuestTotals(int Starts, int Completions, int Visitors);

    public sealed record AcquisitionReport(
        int Days,
        string Since,
        AcquisitionRow[] Rows,
        AcquisitionChannel[] ByChannel,
        AcquisitionTotals Totals,
        FunnelRow[] Funnel,
        GuestLevelRow[] ByLevel,
        GuestTotals Guest);

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

        // ---- Гостевая половина воронки (W2.4) -------------------------------
        // До этого момента выгрузка начиналась с регистрации, то есть самый
        // верх воронки — «сколько людей вообще дошли до результата на /test» —
        // был неизмерим. Гостевые события берутся из своей таблицы: в
        // AnalyticsEvents их не было и быть не могло ([Authorize] + свободная
        // meta), поэтому здесь просто второй источник тех же суток.
        var guestSinceDay = DateOnly.FromDateTime(since);
        var guestEvents = await _context.GuestAnalyticsEvents
            .Where(g => g.Day >= guestSinceDay)
            .Select(g => new { g.Event, g.Day, g.Level, g.IpHash })
            .ToListAsync();

        var guestStarts = guestEvents
            .Where(g => g.Event == AnonymousAnalyticsController.StartedEvent)
            .ToArray();
        var guestCompletions = guestEvents
            .Where(g => g.Event == AnonymousAnalyticsController.CompletedEvent)
            .ToArray();

        var startsByDay = guestStarts
            .GroupBy(g => g.Day)
            .ToDictionary(g => g.Key, g => g.Count());
        var completionsByDay = guestCompletions
            .GroupBy(g => g.Day)
            .ToDictionary(g => g.Key, g => g.Count());
        var visitorsByDay = guestEvents
            .GroupBy(g => g.Day)
            .ToDictionary(g => g.Key, g => g.Select(e => e.IpHash).Distinct().Count());

        var registrationsByDay = registrants
            .GroupBy(r => DateOnly.FromDateTime(r.CreatedAt))
            .ToDictionary(
                g => g.Key,
                g => (Count: g.Count(), Activated: g.Count(r => activatedIds.Contains(r.Id))));

        // День воронки = любой день, в котором случилось что-то из четырёх
        // шагов. Иначе дни, где тест качали, но никто не зарегистрировался,
        // пропадали бы из ответа — а именно они и есть интерес менеджера.
        var funnelDays = startsByDay.Keys
            .Union(completionsByDay.Keys)
            .Union(visitorsByDay.Keys)
            .Union(registrationsByDay.Keys)
            .OrderBy(d => d)
            .Select(day =>
            {
                // Дня нет в регистрациях — TryGetValue оставляет кортеж нулями.
                registrationsByDay.TryGetValue(day, out var dayRegistrations);

                return new FunnelRow(
                    day.ToString("yyyy-MM-dd"),
                    startsByDay.TryGetValue(day, out var s) ? s : 0,
                    completionsByDay.TryGetValue(day, out var c) ? c : 0,
                    visitorsByDay.TryGetValue(day, out var v) ? v : 0,
                    dayRegistrations.Count,
                    dayRegistrations.Activated);
            })
            .ToArray();

        var byLevel = guestCompletions
            .Where(g => g.Level != null)
            .GroupBy(g => g.Level!)
            .Select(g => new GuestLevelRow(g.Key, g.Count()))
            .OrderBy(l => l.Level, StringComparer.Ordinal)
            .ToArray();

        return Ok(new AcquisitionReport(
            days,
            since.ToString("yyyy-MM-dd"),
            rows,
            byChannel,
            new AcquisitionTotals(
                registrants.Count,
                registrants.Count(r => activatedIds.Contains(r.Id))),
            funnelDays,
            byLevel,
            new GuestTotals(
                guestStarts.Length,
                guestCompletions.Length,
                guestEvents.Select(g => g.IpHash).Distinct().Count())));
    }
}
