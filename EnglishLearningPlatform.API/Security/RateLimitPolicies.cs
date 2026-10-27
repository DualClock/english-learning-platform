using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace EnglishLearningPlatform.API.Security;

/// <summary>
/// Политики rate limiting вынесены из Program.cs, чтобы партицирование
/// проверялось юнит-тестами без поднятия всего хоста.
/// auth — 10/мин на связку IP+email; admin — 10/5 мин на значение ключа;
/// feedback/upload/analytics — по IP, как были.
///
/// Регистрация (W1.4.1, SECURITY_GATE R-02/R-10) ограничена двумя
/// независимыми лимитами, потому что ни один из них по отдельности не годится:
///  - signup (политика) — 5/час на нормализованный email: один адрес не даёт
///    перебирать пароли и плодить disposable-аккаунты;
///  - signup-ip (GlobalLimiter только на путь регистрации) — 50/час на IP:
///    NAT школы или офиса с сотней людей больше не ловит 429 на пятом человеке,
///    но и флуд с одного адреса остаётся каппированным.
/// Один эндпоинт не может получить две Endpoint-политики сразу (атрибут на
/// действии перебивает атрибут на контроллере, а не складывается — проверено
/// в аудите R-02), поэтому второй лимит живёт в глобальном лимитере.
/// </summary>
public static class RateLimitPolicies
{
    /*
     * Лимиты регистрации.
     *
     * Константы — значения для продакшена; на стенде их можно переопределить
     * через конфигурацию (Auth__SignupIpPermitLimit). Зачем: 50 регистраций в
     * час на IP при отладке исчерпываются за одну сессию прогонов, и человек
     * натыкается на 429, принимая его за поломку. Значения по умолчанию
     * оставлены продовыми — ослаблять защиту «по умолчанию» нельзя.
     */
    public const int SignupEmailPermitLimit = 5;
    public const int SignupIpPermitLimit = 50;
    public static readonly TimeSpan SignupWindow = TimeSpan.FromHours(1);

    /// <summary>Лимиты, переопределённые конфигурацией (стенд/тесты). 0 — не задано.</summary>
    private static int _signupIpOverride;
    private static int _signupEmailOverride;

    /// <summary>Применить переопределения из конфигурации. Звать один раз при старте.</summary>
    public static void ApplyOverrides(IConfiguration configuration)
    {
        _signupIpOverride = configuration.GetValue("Auth:SignupIpPermitLimit", 0);
        _signupEmailOverride = configuration.GetValue("Auth:SignupEmailPermitLimit", 0);
    }

    private static int EffectiveIpLimit =>
        _signupIpOverride > 0 ? _signupIpOverride : SignupIpPermitLimit;

    private static int EffectiveEmailLimit =>
        _signupEmailOverride > 0 ? _signupEmailOverride : SignupEmailPermitLimit;

    /// <summary>Аутентифицированная аналитика: читатель генерирует события активно.</summary>
    public const int AnalyticsPermitLimit = 120;

    /// <summary>Гостевая воронка /test: легальный burst — 2 события на проход.</summary>
    public const int GuestAnalyticsPermitLimit = 20;

    /// <summary>
    /// Гостевой читатель: 90 запросов в минуту с одного IP. Открытие превью —
    /// два запроса (манифест и глава), дальше по одному на клик по слову.
    /// </summary>
    public const int GuestReaderPermitLimit = 90;

    /// <summary>Путь регистрации: его партицируем по IP отдельным лимитером.</summary>
    public const string RegistrationPath = "/api/auth/register";

    /// <summary>
    /// Ключ партиции «ничего не ограничивать». Один на все прочие пути,
    /// чтобы GlobalLimiter не заводил запись на каждый запрос.
    /// </summary>
    private const string UnpartitionedKey = "no-limit";

    public static void Configure(RateLimiterOptions options)
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

        /*
         * Ответ на отказ + след в логе.
         *
         * Раньше 429 уходил «голым»: тело пустое, в логе строка о статусе, из
         * которой непонятно — это лимит на email, на IP или на эндпоинт.
         * Форма при этом показывала «попробуйте ещё раз», и причину приходилось
         * восстанавливать руками. Теперь отказ сам себя объясняет.
         */
        options.OnRejected = async (context, cancellationToken) =>
        {
            var http = context.HttpContext;
            var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var window)
                ? (int)window.TotalSeconds
                : (int)SignupWindow.TotalSeconds;

            http.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            http.Response.Headers.RetryAfter = retryAfter.ToString();

            var logger = http.RequestServices.GetService<ILoggerFactory>()?.CreateLogger("RateLimit");
            logger?.LogWarning(
                "Лимит исчерпан: {Method} {Path} от {Ip}. Повторить через {RetryAfter} с",
                http.Request.Method,
                http.Request.Path,
                http.Connection.RemoteIpAddress?.ToString() ?? "неизвестен",
                retryAfter);

            await http.Response.WriteAsJsonAsync(
                new
                {
                    error = "Слишком много попыток. Повторите позже.",
                    limit = http.Request.Path.StartsWithSegments(RegistrationPath)
                        ? $"регистрация: {EffectiveIpLimit} в час с одного IP и {EffectiveEmailLimit} на один email"
                        : "запросы к этому разделу",
                    retryAfterSeconds = retryAfter
                },
                cancellationToken);
        };

        foreach (var (name, partition) in EndpointPartitions)
        {
            options.AddPolicy(name, partition);
        }

        // Per-IP кап регистрации: см. комментарий к классу. GlobalLimiter
        // отрабатывает до endpoint-политики и для всех остальных путей
        // возвращает «нет лимитера».
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(RegistrationIpPartition);
    }

    /// <summary>
    /// Все endpoint-партиции одним реестром: политики строятся из него же.
    /// Так «посмотреть на все лимитеры» не требует второго списка, который
    /// кто-нибудь забудет обновить — именно от такого списка пострадал
    /// email-гейт (SECURITY_GATE R-06).
    /// </summary>
    public static IReadOnlyDictionary<string, Func<HttpContext, RateLimitPartition<string>>> EndpointPartitions { get; } =
        new Dictionary<string, Func<HttpContext, RateLimitPartition<string>>>(StringComparer.Ordinal)
        {
            ["auth"] = AuthPartition,
            ["admin"] = AdminPartition,
            ["signup"] = SignupPartition,

            // Обратная связь анонимна: без лимита один человек (или скрипт) может
            // засыпать почту отзывами.
            ["feedback"] = ctx => IpPartition(ctx, permit: 30, window: TimeSpan.FromMinutes(10)),

            // Загрузка аватара/EPUB — тяжёлые операции (декодирование картинок,
            // распаковка архива). Без лимита ими легко исчерпать CPU и память.
            ["upload"] = ctx => IpPartition(ctx, permit: 10, window: TimeSpan.FromMinutes(5)),

            // Клиентская аналитика пишется в БД на каждый запрос — ограничиваем
            // частоту, чтобы один клиент не залил таблицу событиями.
            ["analytics"] = ctx => IpPartition(ctx, permit: AnalyticsPermitLimit, window: TimeSpan.FromMinutes(1)),

            // Гостевая воронка /test (W2.4). Отдельная политика, а не «analytics»,
            // по двум причинам:
            //  1. это другой лимитер: общий с аутентифицированным путём бюджет
            //     означал бы, что анонимный скрипт выжигает корзину читателя с тем
            //     же адресом;
            //  2. легальный burst гостя на /test — 2 события на проход (старт и
            //     результат). 120/мин означают, что флудер пишет в шесть раз
            //     быстрее, чем лимитер успевает его остановить.
            // 20/мин на IP: щедро для человека за роутером (несколько тестов в
            // минуту), тесно для скрипта.
            ["guest-analytics"] = ctx => IpPartition(ctx, permit: GuestAnalyticsPermitLimit, window: TimeSpan.FromMinutes(1)),

            // Гостевое чтение (R2): открытие превью — 2 запроса (манифест +
            // глава), дальше по одному запросу на клик по слову. 90/мин
            // покрывает разбор абзаца вручную (десятки кликов), но не даёт
            // скрипту перебирать словарь в цикле с одного адреса.
            // Отдельная политика, потому что `reader` партицируется по
            // `IP|email из тела`, а у GET тела нет — корзина стала бы общей
            // на весь мир.
            ["guest-reader"] = ctx => IpPartition(ctx, permit: GuestReaderPermitLimit, window: TimeSpan.FromMinutes(1)),

            // Читалка: позиция сохраняется каждые 1,5 с, карман — по тапу.
            // 240/мин на пользователя с запасом покрывает листание и разбор,
            // но не даёт скрипту писать прогресс сотнями запросов в секунду.
            ["reader"] = ctx => RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPartitionKeys.Identity(ctx),
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 240,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0
                }),
        };

    // Два адреса из TEST-NET-2/TEST-NET-3: партиции проверяются прогоном на них,
    // без интернета и без риска пересечься с реальным трафиком
    private const string ProbeIpA = "198.51.100.7";
    private const string ProbeIpB = "203.0.113.9";

    /// <summary>
    /// Зависят ли лимиты от адреса пира. Определяется не списком и не
    /// предположением, а прогоном: если два запроса с разных IP попадают в
    /// разные партиции — лимитер делит корзину между клиентами по IP, и за
    /// прокси эта корзина становится общей на всех (W1.4.2).
    /// </summary>
    public static bool AnyPartitionDependsOnClientIp() =>
        PartitionsDependOnIp(EndpointPartitions.Values.Append(RegistrationIpPartition));

    public static bool PartitionsDependOnIp(IEnumerable<Func<HttpContext, RateLimitPartition<string>>> partitions)
    {
        foreach (var partition in partitions)
        {
            if (partition(ProbeContext(ProbeIpA)).PartitionKey != partition(ProbeContext(ProbeIpB)).PartitionKey)
            {
                return true;
            }
        }

        return false;
    }

    private static HttpContext ProbeContext(string ip) => new DefaultHttpContext
    {
        Connection = { RemoteIpAddress = IPAddress.Parse(ip) },
        // POST на путь регистрации: часть партиций (signup, GlobalLimiter)
        // различают метод и путь, probes должны выглядеть как живой запрос
        Request = { Method = HttpMethods.Post, Path = new PathString(RegistrationPath) }
    };

    public static RateLimitPartition<string> AuthPartition(HttpContext context) =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPartitionKeys.Identity(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            });

    public static RateLimitPartition<string> AdminPartition(HttpContext context) =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPartitionKeys.AdminIdentity(context),
            _ => new FixedWindowRateLimiterOptions
            {
                // 10 запросов в 5 минут было разумно для служебных сидов,
                // которые дёргают вручную. CMS меняет картину: админ правит
                // контент пачками (создал категорию, накидал десять слов,
                // поправил два), и старый лимит упирался в 429 посреди работы.
                //
                // 240/мин — это защита от бесконечного цикла в скрипте, а не
                // ограничение живой работы. Партиция — по пользователю, так
                // что один админ не влияет на другого.
                PermitLimit = AdminPermitLimit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            });

    /// <summary>Лимит админских запросов: константа вынесена, чтобы тест и прод считали одинаково.</summary>
    public const int AdminPermitLimit = 240;

    /// <summary>5 регистраций в час на email. Ключ — сам email, а не IP.</summary>
    public static RateLimitPartition<string> SignupPartition(HttpContext context) =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPartitionKeys.SignupEmail(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = EffectiveEmailLimit,
                Window = SignupWindow,
                QueueLimit = 0
            });

    /// <summary>
    /// 50 регистраций в час на IP — лимит для NAT-когорты. Вне POST
    /// /api/auth/register лимитер не применяется вовсе.
    /// </summary>
    public static RateLimitPartition<string> RegistrationIpPartition(HttpContext context)
    {
        if (!IsRegistrationRequest(context))
        {
            return RateLimitPartition.GetNoLimiter(UnpartitionedKey);
        }

        return RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPartitionKeys.IpOnly(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = EffectiveIpLimit,
                Window = SignupWindow,
                QueueLimit = 0
            });
    }

    public static bool IsRegistrationRequest(HttpContext context) =>
        HttpMethods.IsPost(context.Request.Method) &&
        context.Request.Path.StartsWithSegments(RegistrationPath);

    private static RateLimitPartition<string> IpPartition(HttpContext context, int permit, TimeSpan window) =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPartitionKeys.IpOnly(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permit,
                Window = window,
                QueueLimit = 0
            });
}
