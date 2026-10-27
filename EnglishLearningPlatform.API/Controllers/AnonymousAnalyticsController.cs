using System.Text.Json;
using System.Text.RegularExpressions;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// POST /api/analytics/anonymous — верх воронки публичного /test (W2.4).
///
/// Почему отдельный контроллер, а не снятие `[Authorize]` с `AnalyticsController`:
/// тот путь принимает свободную строку `meta` длиной до 500 символов и пишет её
/// под реальным пользователем. Открыть его анонимно — значит отдать прод-таблицу
/// аналитики любому скрипту, который мимо проходил: спам в собственных счётчиках
/// и хранилище чужих текстов (PII, ссылки, что угодно) в нашей базе. Здесь же
/// контракт настолько узкий, что свободному тексту места нет: ни одного поля,
/// куда его можно положить.
///
/// Контракт (и есть весь контракт):
///  - `event` — только <see cref="AllowedEvents"/>;
///  - `level` — только <see cref="AllowedLevels"/>, и только у completed;
///  - `dedupeKey` — случайный nonce клиента, гасит повтор отправки;
///  - никаких других полей: неизвестное свойство = 400, а не «молча игнорируем»,
///    потому что молча игнорируемое поле потом кто-нибудь начнёт слать.
///
/// Защита пути: отдельная политика лимита по IP (`guest-analytics`, в шесть раз
/// теснее аутентифицированной — см. RateLimitPolicies), кап тела, обязательный
/// Content-Type: application/json и отсутствие записи чего-либо, кроме имени
/// события, кода уровня, хеша IP, суток и часа (плюс nonce против дублей).
///
/// В записи нет ни IP, ни User-Agent, ни referer, ни cookie: см. Models/GuestAnalyticsEvent.
/// </summary>
[ApiController]
[Route("api/analytics")]
[AllowAnonymous]
public class AnonymousAnalyticsController : ControllerBase
{
    /// <summary>Гость открыл тест и получил вопросы. Идёт строго один раз на проход.</summary>
    public const string StartedEvent = "placement_test_started";

    /// <summary>Гость увидел результат. Единственное место, где у гостя есть уровень.</summary>
    public const string CompletedEvent = "placement_test_completed";

    /// <summary>Гость увидел страницу когорты (W3.4) — самый верх воронки до /test.</summary>
    public const string CohortViewedEvent = "cohort_page_viewed";

    /// <summary>Гость увидел публичную полку книг (W3.4) — вторая входная дверь.</summary>
    public const string LibraryViewedEvent = "library_page_viewed";

    /// <summary>
    /// Whitelist гостевых событий. Ровно два, и это не забывчивость.
    ///
    /// Третье событие из ТЗ — `placement_test_abandoned_step` («ушёл со
    /// страницы до результата») — сюда сознательно НЕ включено, потому что с
    /// /test оно не отправляемо надёжно:
    ///  1. доставить запрос в момент закрытия вкладки умеет только
    ///     `navigator.sendBeacon`, а он кросс-доменно обязан идти «простым»
    ///     запросом, то есть без `application/json` — иначе браузер сначала
    ///     шлёт preflight, который умирающая страница дождаться не может.
    ///     Разрешать же на анонимном write-пути второй Content-Type — платить
    ///     расширяющейся поверхностью атаки за метрику, которая и так не видна
    ///     точнее (см. 2);
    ///  2. `visibilitychange`/`pagehide` стреляют и когда человек просто
    ///     переключил вкладку или ушёл в bfcache, вернувшись через секунду.
    ///     Так «ушёл» начал бы считать читателей, которые никуда не уходили, —
    ///     а врущая метрика хуже отсутствующей: по ней принимают решения;
    ///  3. полезное из этого числа и без того следует из первых двух:
    ///     `starts − completions` = сколько не дошли. Теряется только разбивка
    ///     «на каком вопросе», а на бете с десятками людей она статистический
    ///     шум.
    /// Когда появится надёжный способ (например, свой same-origin прокси для
    /// биконов), событие добавляется сюда одним элементом — контракт на это
    /// покрыт тестом.
    ///
    /// Два событий верха воронки (W3.4) — `cohort_page_viewed` и
    /// `library_page_viewed` — закрыли дыру «человек увидел когорту, но в
    /// воронке его нет до самого /test»: обе страницы серверные и раньше не
    /// измерялись вообще. Ни slug, ни query, ни user-agent к ним не пишется:
    /// slug — это 18 названий книг сегодня и чужая книга завтра, то есть всё
    /// тот же свободный текст, только замаскированный под идентификатор.
    /// </summary>
    public static readonly IReadOnlySet<string> AllowedEvents =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            StartedEvent, CompletedEvent, CohortViewedEvent, LibraryViewedEvent
        };

    /// <summary>Уровни, которые умеет отдавать сервер (`ProfileController.SubmitPlacementResult`).</summary>
    public static readonly IReadOnlySet<string> AllowedLevels =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "a1", "a2", "b1", "b2", "c1" };

    /// <summary>
    /// Жёсткий кап тела. Весь легальный запрос — 3 коротких поля, ~120 байт;
    /// 512 оставляют запас на charset и пробелы и отрезают любую «свободную
    /// строку» ещё до чтения в память.
    /// </summary>
    public const int MaxBodyBytes = 512;

    /// <summary>Поля, которые запрос имеет право прислать. Всё остальное — 400.</summary>
    private static readonly HashSet<string> AllowedFields =
        new(StringComparer.OrdinalIgnoreCase) { "event", "level", "dedupeKey" };

    private static readonly Regex DedupeKeyPattern =
        new("^[A-Za-z0-9_-]{8,64}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly ApplicationDbContext _context;
    private readonly ILogger<AnonymousAnalyticsController> _logger;
    private readonly string _ipSalt;

    public AnonymousAnalyticsController(
        ApplicationDbContext context,
        ILogger<AnonymousAnalyticsController> logger,
        IConfiguration configuration)
    {
        _context = context;
        _logger = logger;
        _ipSalt = GuestIdentity.ResolveSalt(configuration["Analytics:GuestIpSalt"]);

        // Без ключа соли хеши меняются на каждом рестарте: «уникальные гости за
        // сутки» тогда занижаются/завышаются. Считать воронку не мешает, но
        // оператор должен знать, что у него временный ключ.
        if (!GuestIdentity.HasConfiguredSalt(configuration["Analytics:GuestIpSalt"]))
        {
            _logger.LogWarning(
                "Analytics:GuestIpSalt не задан — IpHash гостевых событий солится ключом процесса " +
                "и меняется при каждом рестарте. Задайте Analytics__GuestIpSalt, чтобы «уникальные гости» считались корректно.");
        }
    }

    // POST: api/analytics/anonymous
    [HttpPost("anonymous")]
    [EnableRateLimiting("guest-analytics")]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> Track([FromBody] JsonElement body, CancellationToken cancellationToken)
    {
        // 1. Только JSON. Проверка явная, а не через [Consumes]: так её видно в
        //    тестах без MVC-конвейера, и она же отсекает form/multipart-посылки.
        var contentType = Request.ContentType;
        if (contentType is null || !contentType.Contains("application/json", StringComparison.OrdinalIgnoreCase))
        {
            return StatusCode(StatusCodes.Status415UnsupportedMediaType,
                new { message = "Content-Type должен быть application/json" });
        }

        // 2. Кап тела по Content-Length (chunked досылает RequestSizeLimit).
        if (Request.ContentLength > MaxBodyBytes)
        {
            return StatusCode(StatusCodes.Status413RequestEntityTooLarge, new { message = "Слишком большое тело" });
        }

        // 3. Форма тела: строго один объект с известными ключами.
        if (body.ValueKind != JsonValueKind.Object)
        {
            return BadRequest(new { message = "Ожидался JSON-объект" });
        }

        string? eventName = null;
        string? level = null;
        string? dedupeKey = null;

        foreach (var property in body.EnumerateObject())
        {
            if (!AllowedFields.Contains(property.Name))
            {
                // Свободный текст не приметим: любого нового ключа в контракте нет.
                return BadRequest(new { message = $"Неизвестное поле: {TrimForLog(property.Name)}" });
            }

            if (property.Value.ValueKind != JsonValueKind.String)
            {
                // Только строки и только известные: числа/вложенные объекты —
                // это способ протащить в тело неограниченную структуру.
                return BadRequest(new { message = $"Поле {property.Name} должно быть строкой" });
            }

            var value = property.Value.GetString() ?? string.Empty;
            if (value.Length > MaxFieldValueLength)
            {
                return BadRequest(new { message = $"Поле {property.Name} слишком длинное" });
            }

            // Метки case'ов — нижний регистр имени поля: сверка идёт по
            // ToLowerInvariant, чтобы "dedupeKey" и "DedupeKey" были одним
            // полем, а не «неизвестным свойством».
            switch (property.Name.ToLowerInvariant())
            {
                case "event": eventName = value; break;
                case "level": level = value; break;
                case "dedupekey": dedupeKey = value; break;
            }
        }

        if (string.IsNullOrWhiteSpace(eventName))
        {
            return BadRequest(new { message = "Поле event обязательно" });
        }

        if (!AllowedEvents.Contains(eventName))
        {
            return BadRequest(new { message = "Unknown event" });
        }

        // Имя события приводим к нижнему регистру один раз: и в записи, и в
        // проверке повтора должно лежать ровно одно и то же значение, иначе
        // "Placement_Test_Started" и "placement_test_started" стали бы двумя
        // событиями для одного прохода.
        eventName = eventName.ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(dedupeKey) || !DedupeKeyPattern.IsMatch(dedupeKey))
        {
            return BadRequest(new { message = "Поле dedupeKey обязательно (8–64 символа латиницей)" });
        }

        // Уровень — единственное «значение» гостевого события, и он обязан быть
        // из шкалы, а не чем угодно: completed без уровня метрику не даёт,
        // а started с уровнем — признак сломанного клиента.
        if (string.Equals(eventName, CompletedEvent, StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(level) || !AllowedLevels.Contains(level))
            {
                return BadRequest(new { message = "Для завершения теста нужен уровень из a1…c1" });
            }

            level = level.ToLowerInvariant();
        }
        else if (!string.IsNullOrWhiteSpace(level))
        {
            return BadRequest(new { message = "Уровень бывает только у завершения теста" });
        }

        try
        {
            var now = DateTime.UtcNow;
            var day = DateOnly.FromDateTime(now);
            var ipHash = GuestIdentity.IpHash(_ipSalt, day, GuestIdentity.ClientIp(HttpContext));

            // Вежливая проверка повтора: второй запрос с тем же nonce — это
            // сетевой повтор или перемонтировавшийся эффект, а не новый гость.
            // Ответ всё равно 200: аналитика не должна подсказывать клиенту, что
            // «что-то не так» (см. комментарий у chapter_opened_first).
            if (await _context.GuestAnalyticsEvents.AnyAsync(
                    g => g.Event == eventName && g.DedupeKey == dedupeKey, cancellationToken))
            {
                return Ok();
            }

            _context.GuestAnalyticsEvents.Add(new GuestAnalyticsEvent
            {
                Event = eventName,
                IpHash = ipHash,
                Level = level,
                Day = day,
                Hour = now.Hour,
                DedupeKey = dedupeKey
            });
            await _context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsDuplicateKey(ex))
        {
            // Гонка двух повторов: уникальный индекс (event, dedupeKey) не пустил
            // вторую строку. Для клиента это всё равно успешная отправка.
            _logger.LogDebug(ex, "Гостевое аналитическое событие повторилось в гонке");
            return Ok();
        }
        catch (Exception ex)
        {
            // Аналитика никогда не ломает пользовательский сценарий — ни гостю,
            // ни нам: падение /test из-за счётчика дороже самого счётчика.
            _logger.LogWarning(ex, "Guest analytics tracking failed");
        }

        return Ok();
    }

    /// <summary>Длина строки, дальше которой в это API ничего не помещается.</summary>
    private const int MaxFieldValueLength = 64;

    /// <summary>
    /// Имя неизвестного поля уходит в ответ обрезанным: эхо произвольной длины
    /// превратило бы «защиту от свободных строк» в endpoint для рефлексии мусора.
    /// </summary>
    private static string TrimForLog(string value) =>
        value.Length <= MaxFieldValueLength ? value : value[..MaxFieldValueLength];

    /// <summary>
    /// Нарушение уникальности у провайдеров выглядит по-разному: Postgres —
    /// «duplicate key value violates unique constraint», SQLite — «UNIQUE
    /// constraint failed». Проверяем текст внутреннего исключения, потому что
    /// для клиента исход один: событие уже записано.
    /// </summary>
    private static bool IsDuplicateKey(DbUpdateException ex) =>
        ex.InnerException is not null &&
        (ex.InnerException.Message.Contains("23505", StringComparison.Ordinal) ||
         ex.InnerException.Message.Contains("duplicate key", StringComparison.OrdinalIgnoreCase) ||
         ex.InnerException.Message.Contains("UNIQUE constraint", StringComparison.OrdinalIgnoreCase));
}
