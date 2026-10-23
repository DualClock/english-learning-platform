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
        FirstChapterEvent,
        PulseSeenEvent, PulseAnsweredEvent, PulseDismissedEvent
    };

    /// <summary>
    /// Активационное событие: первая открытая глава. Пишется ровно один раз на
    /// пользователя и именно по нему видно, что регистрация превратилась в чтение.
    /// </summary>
    public const string FirstChapterEvent = "chapter_opened_first";

    // ---- Feedback Pulse (W4.1) ----------------------------------------------
    //
    // Три имени и ни одного лишнего. Микроопрос живёт в читалке и измеряет ровно
    // одно: что бесит читателя сильнее всего. Для этого нужны три перехода —
    // «показали», «ответил», «закрыл» — и ничего больше:
    //  - `seen` нужен для знаменателя (без него «15,97% ответов» считается от
    //    воздуха, и мы не увидим, что блок просто не доходил до человека);
    //  - `dismissed` отделяет «не сейчас» от «не отвечает» — это единственный
    //    способ честными глазами посмотреть на частотное правило;
    //  - `answered` несёт единственный осмысленный payload — код варианта.
    //
    // Свободного текста здесь нет намеренно: meta длиной до 500 символов в
    // прод-таблице аналитики — это чужой отзыв не в том месте и потенциальный
    // PII, ради которого мы бы хранили то, что обещали не хранить. Развёрнутый
    // отзыв живёт своим путём (POST /api/feedback) и в pulse не попадает.

    /// <summary>Блок показан читателю. meta — пустая строка.</summary>
    public const string PulseSeenEvent = "beta_pulse_seen";

    /// <summary>Читатель нажал один из вариантов. meta — код варианта.</summary>
    public const string PulseAnsweredEvent = "beta_pulse_answered";

    /// <summary>Читатель закрыл блок крестиком. meta — пустая строка или `dismiss`.</summary>
    public const string PulseDismissedEvent = "beta_pulse_dismissed";

    /// <summary>
    /// Пауза между показами на одного человека. Правило держит сервер, а не
    /// клиент: localStorage читалки живёт в одном браузере, а у человека их три,
    /// и без этого мы мерили бы раздражение вместо мнений.
    /// </summary>
    public const int PulseCooldownDays = 7;

    /// <summary>
    /// Закрытый набор ответов. Совпадает с тремя кнопками блока во фронтенде
    /// плюс `other`: серверный домен сознательно шире сегодняшнего UI, чтобы
    /// четвёртый вариант можно было добавить правкой клиента, а не деплоем API.
    /// Любое другое значение — 400 (см. <see cref="PulseMetaError"/>).
    /// </summary>
    public static readonly IReadOnlySet<string> PulseAnswerOptions =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "word", "repetition", "text", "other" };

    /// <summary>
    /// Что имеет право лежать в meta у двух «имрессионных» событий: пусто или
    /// `dismiss`. Регистр и пробелы не учитываются, потому что нормализацию
    /// делает сервер при записи, а клиент обязан прислать нижний регистр.
    /// </summary>
    public static readonly IReadOnlySet<string> PulseImpressionMetas =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "", "dismiss" };

    /// <summary>Импульсные события одним множеством — из него же считается `pulse` в выгрузке.</summary>
    public static IReadOnlySet<string> PulseEvents { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        PulseSeenEvent, PulseAnsweredEvent, PulseDismissedEvent
    };

    private static bool IsPulseEvent(string? eventName) =>
        eventName is not null && PulseEvents.Contains(eventName.ToLowerInvariant());

    /// <summary>
    /// Проверка meta для трёх pulse-событий. Возвращает текст ошибки (тогда
    /// эндпоинт отвечает 400) или null, когда значение закрытого набора годно.
    ///
    /// Для `answered` пустая meta отклоняется отдельно от «неизвестного текста»:
    /// это разные поломки клиента. Первый случай — кнопка нажалась без варианта
    /// (значит знаменатель `seen` у нас потеряет числитель), второй — в аналитику
    /// пытается сесть свободная строка.
    /// </summary>
    public static string? PulseMetaError(string? eventName, string? meta)
    {
        if (!IsPulseEvent(eventName)) return null;

        var normalized = (meta ?? string.Empty).Trim();
        var name = eventName!.ToLowerInvariant();

        if (string.Equals(name, PulseAnsweredEvent, StringComparison.Ordinal))
        {
            return string.IsNullOrEmpty(normalized)
                ? "Для beta_pulse_answered нужен код варианта"
                : PulseAnswerOptions.Contains(normalized)
                    ? null
                    : "beta_pulse_answered принимает только один из кодов варианта";
        }

        return PulseImpressionMetas.Contains(normalized)
            ? null
            : "Бета-pulse событие без ответа принимает только пустую meta или dismiss";
    }

    /// <summary>meta pulse-событий перед записью: нижний регистр, без мусора по краям.</summary>
    private static string? NormalizePulseMeta(string? meta)
    {
        var normalized = (meta ?? string.Empty).Trim().ToLowerInvariant();
        return normalized.Length == 0 ? string.Empty : normalized;
    }

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

        // Pulse-события — единственный случай, где имя события недостаточно:
        // у них есть payload, и он обязан быть из закрытого набора. Остальные
        // события проходят сюда с null и пишутся как раньше.
        var metaError = PulseMetaError(dto.Event, dto.Meta);
        if (metaError is not null)
        {
            return BadRequest(new { message = metaError });
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
                // meta pulse приводится к каноническому виду на сервере: иначе
                // "Word" и "word" стали бы двумя вариантами в выгрузке, а менеджер
                // читал бы два ответа там, где был один.
                Meta = IsPulseEvent(dto.Event)
                    ? NormalizePulseMeta(dto.Meta)
                    : dto.Meta is { Length: > 500 } ? dto.Meta[..500] : dto.Meta
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

    /// <summary>
    /// Ответ проверки частоты: показывать ли читателю inline-блок.
    ///
    /// `Reason` — короткий код, а не текст: клиенту он нужен только для
    /// собственных логов и для ответа на «почему блок не появляется», а в UI
    /// ничего не формулирует.
    /// </summary>
    public sealed record PulseEligibility(bool Eligible, string? Reason);

    /// <summary>Код причины отказа: человек ещё не начал читать.</summary>
    public const string PulseReasonNotActivated = "not_activated";

    /// <summary>Код причины отказа: показ был меньше <see cref="PulseCooldownDays"/> дней назад.</summary>
    public const string PulseReasonTooRecent = "too_recent";

    /// <summary>
    /// GET /api/analytics/pulse/eligible — можно ли показать pulse этому
    /// человеку сейчас.
    ///
    /// Правило держит сервер, а не читалка. Клиентский флаг в localStorage
    /// работает ровно в одном браузере: с телефоном, ноутбуком и планшетом
    /// читатель получил бы по блоку на каждое устройство, и `beta_pulse_seen`
    /// считал бы не людей, а устройства — «сколько людей раздражает опрос»
    /// вместо «сколько людей ответили».
    ///
    /// Условий два, и оба про данные, а не про предположения:
    ///  1. `chapter_opened_first` уже в базе. Выбран именно этот вариант, а не
    ///     «показывать в момент, когда событие только что засчитали»: вопрос
    ///     «что бесит в чтении» на первой секунде первой главы спрашивается с
    ///     пустого места, и ответ на него описывает ожидание, а не опыт. Для
    ///     метрики это хуже вдвойне — `beta_pulse_answered` начал бы означать
    ///     «человек открыл книгу и тут же потыкал кнопки». Требуя событие в
    ///     базе, мы спрашиваем того, кто уже читал: блок появится со второй
    ///     главы или со второго захода, и это ровно тот момент, когда есть что
    ///     вспомнить. Побочный эффект тот же и в пользу правила: на самом первом
    ///     открытии активационное событие пишется параллельным запросом и почти
    ///     всегда ещё не долетело, так что гонка «показ до активации» невозможна;
    ///  2. за последние <see cref="PulseCooldownDays"/> суток нет ни одного
    ///     pulse-события этого пользователя. Считаемся по всем трём именам:
    ///     человек, которому блок уже показали и который его закрыл, не обязан
    ///     встречать его снова через пять минут на другом устройстве.
    ///
    /// Новая таблица для этого не заводится: факт показа уже лежит в
    /// `AnalyticsEvents` с индексом (UserId, Event) и (UserId, CreatedAt),
    /// поэтому миграция не нужна, а рестарт процесса ничего не «забывает» —
    /// состояние в базе.
    /// </summary>
    [HttpGet("pulse/eligible")]
    [EnableRateLimiting("analytics")]
    public async Task<IActionResult> GetPulseEligibility(CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        var since = DateTime.UtcNow.AddDays(-PulseCooldownDays);

        // Одна выборка на два вопроса: имена событий и создатель уже в индексе
        // (UserId, CreatedAt), а строк за неделю у читателя десятки.
        var events = await _context.AnalyticsEvents
            .Where(ae => ae.UserId == userId &&
                         (ae.Event == FirstChapterEvent ||
                          ae.Event == PulseSeenEvent ||
                          ae.Event == PulseAnsweredEvent ||
                          ae.Event == PulseDismissedEvent))
            .Select(ae => new { ae.Event, ae.CreatedAt })
            .ToListAsync(cancellationToken);

        if (!events.Any(e => e.Event == FirstChapterEvent))
        {
            return Ok(new PulseEligibility(false, PulseReasonNotActivated));
        }

        if (events.Any(e => PulseEvents.Contains(e.Event) && e.CreatedAt >= since))
        {
            return Ok(new PulseEligibility(false, PulseReasonTooRecent));
        }

        return Ok(new PulseEligibility(true, null));
    }

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
    ///
    /// `CohortViews` и `LibraryViews` (W3.4) — две ступени ДО теста: просмотр
    /// страницы когорты и просмотр публичной полки. Новые колонки добавлены в
    /// конец, а не вставлены в середину: порядок полей в JSON — это контракт для
    /// читающих выгрузку скриптов, существующие имена и их значения не
    /// меняются. Считаются как и всё остальное в funnel — по записям `Day`,
    /// поэтому день, в котором были только просмотры, из ответа не исчезает.
    /// </summary>
    public sealed record FunnelRow(
        string Date,
        int GuestStarts,
        int GuestCompletions,
        int GuestVisitors,
        int Registrations,
        int Activated,
        int CohortViews,
        int LibraryViews);

    /// <summary>Распределение гостевых результатов по уровням — зачем человек пришёл и что ему предлагать дальше.</summary>
    public sealed record GuestLevelRow(string Level, int Completions);

    /// <summary>
    /// Событие pulse в окне выгрузки. Приватно контроллера: это форма для
    /// агрегации в памяти, а не часть контракта ответа.
    /// </summary>
    private sealed record PulseEventRow(string Event, DateTime CreatedAt, string? Meta);

    /// <summary>Сутки показов микроопроса: знаменатель и оба «не ответа».</summary>
    public sealed record PulseDay(string Date, int Seen, int Answered, int Dismissed);

    /// <summary>Сколько раз выбран один вариант за всё окно.</summary>
    public sealed record PulseAnswer(string Option, int Count);

    /// <summary>
    /// Pulse для менеджера (W4.1): `days` — по суткам, `answers` — по вариантам.
    ///
    /// Дни идут по той же сетке, что и `funnel`, плюс сутки, в которых случилось
    /// только pulse-событие: пустой день остаётся в ответе с нулями, потому что
    /// «показали 6 раз, ответили 0» и есть предмет разговора, а не отсутствие
    /// данных. Скрипту удобнее читать два массива с одинаковыми датами.
    ///
    /// В `answers` вариант — то, что лежит в meta (для `answered` сервер пишет
    /// только закрытый набор, см. <see cref="PulseMetaError"/>). Если в истории
    /// всё же встретится не-вариант, он сгруппируется как есть: прятать аномалию
    /// внутри «other» значило бы врать менеджеру.
    /// </summary>
    public sealed record PulseReport(PulseDay[] Days, PulseAnswer[] Answers);

    /// <summary>
    /// Гостевые итоги за окно. `Visitors` — разных хешей IP, а не людей: семья за
    /// одним NAT = один гость. С W3.4 это число считается по всем гостевым
    /// событиям, то есть включает и зрителей /beta с /library, — раньше в таблице
    /// были только события /test, поэтому на исторических днях колонка уже, чем на
    /// новых. `CohortViews`/`LibraryViews` — просмотры двух публичных страниц:
    /// это проходы, а не уникальные люди (один человек трижды открывший /beta
    /// даёт три просмотра).
    /// </summary>
    public sealed record GuestTotals(
        int Starts,
        int Completions,
        int Visitors,
        int CohortViews,
        int LibraryViews);

    public sealed record AcquisitionReport(
        int Days,
        string Since,
        AcquisitionRow[] Rows,
        AcquisitionChannel[] ByChannel,
        AcquisitionTotals Totals,
        FunnelRow[] Funnel,
        GuestLevelRow[] ByLevel,
        GuestTotals Guest,
        // W4.1: `pulse` добавлен последним — порядок ключей JSON читают скрипты
        // выгрузки, и существующие имена не сдвинулись ни на позицию.
        PulseReport Pulse);

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

        // Просмотры двух публичных страниц (W3.4) — ступени, которые стоят ДО
        // /test. Отдельные счётчики, а не «ещё одни старты»: у просмотра нет
        // ни уровня, ни прохода, и смешивать его с началом теста значило бы
        // потерять ровно тот вопрос, ради которого метрика и заводилась
        // («человек увидел когорту → вступил»).
        var cohortViews = guestEvents
            .Where(g => g.Event == AnonymousAnalyticsController.CohortViewedEvent)
            .ToArray();
        var libraryViews = guestEvents
            .Where(g => g.Event == AnonymousAnalyticsController.LibraryViewedEvent)
            .ToArray();

        var startsByDay = guestStarts
            .GroupBy(g => g.Day)
            .ToDictionary(g => g.Key, g => g.Count());
        var completionsByDay = guestCompletions
            .GroupBy(g => g.Day)
            .ToDictionary(g => g.Key, g => g.Count());
        var cohortViewsByDay = cohortViews
            .GroupBy(g => g.Day)
            .ToDictionary(g => g.Key, g => g.Count());
        var libraryViewsByDay = libraryViews
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

        var pulseEvents = await _context.AnalyticsEvents
            .Where(ae => ae.CreatedAt >= since &&
                         (ae.Event == PulseSeenEvent ||
                          ae.Event == PulseAnsweredEvent ||
                          ae.Event == PulseDismissedEvent))
            .Select(ae => new PulseEventRow(ae.Event, ae.CreatedAt, ae.Meta))
            .ToListAsync();

        var pulseSeenByDay = PulseDayHistogram(pulseEvents, PulseSeenEvent);
        var pulseAnsweredByDay = PulseDayHistogram(pulseEvents, PulseAnsweredEvent);
        var pulseDismissedByDay = PulseDayHistogram(pulseEvents, PulseDismissedEvent);

        // День воронки = любой день, в котором случилось что-то из шести шагов.
        // Иначе дни, где тест качали, но никто не зарегистрировался, пропадали бы
        // из ответа — а именно они и есть интерес менеджера. Просмотры в этом
        // перечне обязательны: страница когорты, которую посмотрели в тишине
        // («ни регистраций, ни тестов»), и есть верх воронки, который мы наконец
        // увидели.
        var funnelDaySet = startsByDay.Keys
            .Union(completionsByDay.Keys)
            .Union(visitorsByDay.Keys)
            .Union(cohortViewsByDay.Keys)
            .Union(libraryViewsByDay.Keys)
            .Union(registrationsByDay.Keys)
            .OrderBy(d => d)
            .ToArray();

        var funnelDays = funnelDaySet
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
                    dayRegistrations.Activated,
                    cohortViewsByDay.TryGetValue(day, out var cv) ? cv : 0,
                    libraryViewsByDay.TryGetValue(day, out var lv) ? lv : 0);
            })
            .ToArray();

        // Сетка дней pulse = сетка дней воронки плюс сутки, где был только
        // микроопрос. Формат даты тот же, что у `funnel`, поэтому два массива
        // читаются скриптом по индексу, а не склейкой по строке.
        var pulseDaySet = funnelDaySet
            .Union(pulseSeenByDay.Keys)
            .Union(pulseAnsweredByDay.Keys)
            .Union(pulseDismissedByDay.Keys)
            .OrderBy(d => d)
            .Select(day => new PulseDay(
                day.ToString("yyyy-MM-dd"),
                PulseCountOfDay(pulseSeenByDay, day),
                PulseCountOfDay(pulseAnsweredByDay, day),
                PulseCountOfDay(pulseDismissedByDay, day)))
            .ToArray();

        var pulseAnswers = pulseEvents
            .Where(p => p.Event == PulseAnsweredEvent)
            .GroupBy(p => (p.Meta ?? string.Empty).Trim().ToLowerInvariant())
            .Select(g => new PulseAnswer(g.Key, g.Count()))
            // Самый частый вариант первым: менеджер читает ответ сверху вниз.
            // При равных счётчиках — по имени варианта, чтобы две выгрузки одного
            // дня совпадали построчно и их можно было сравнить без ручной правки.
            .OrderByDescending(a => a.Count)
            .ThenBy(a => a.Option, StringComparer.Ordinal)
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
                guestEvents.Select(g => g.IpHash).Distinct().Count(),
                cohortViews.Length,
                libraryViews.Length),
            new PulseReport(pulseDaySet, pulseAnswers)));
    }

    /// <summary>
    /// Счётчик одного pulse-события по суткам UTC. Усечение даты в памяти, а не
    /// в LINQ — ровно та же причина, что у остальной агрегации выгрузки:
    /// группировка по усечённому времени Npgsql переводит в SQL с приведением
    /// типов, и на этом месте отчёт ломается тихо.
    /// </summary>
    private static Dictionary<DateOnly, int> PulseDayHistogram(
        IEnumerable<PulseEventRow> events,
        string eventName) =>
        events
            .Where(e => string.Equals(e.Event, eventName, StringComparison.OrdinalIgnoreCase))
            .GroupBy(e => DateOnly.FromDateTime(e.CreatedAt))
            .ToDictionary(g => g.Key, g => g.Count());

    private static int PulseCountOfDay(Dictionary<DateOnly, int> byDay, DateOnly day) =>
        byDay.TryGetValue(day, out var count) ? count : 0;
}
