using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace EnglishLearningPlatform.API.Security;

/// <summary>
/// Политики rate limiting вынесены из Program.cs, чтобы партицирование
/// проверялось юнит-тестами без поднятия всего хоста.
/// auth — 10/мин на связку IP+email; admin — 10/5 мин там же;
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
    public const int SignupEmailPermitLimit = 5;
    public const int SignupIpPermitLimit = 50;
    public static readonly TimeSpan SignupWindow = TimeSpan.FromHours(1);

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

        options.AddPolicy("auth", AuthPartition);
        options.AddPolicy("admin", AdminPartition);
        options.AddPolicy("signup", SignupPartition);

        // Обратная связь анонимна: без лимита один человек (или скрипт) может
        // засыпать почту отзывами.
        options.AddPolicy("feedback", ctx => IpPartition(ctx, permit: 30, window: TimeSpan.FromMinutes(10)));

        // Загрузка аватара/EPUB — тяжёлые операции (декодирование картинок,
        // распаковка архива). Без лимита ими легко исчерпать CPU и память.
        options.AddPolicy("upload", ctx => IpPartition(ctx, permit: 10, window: TimeSpan.FromMinutes(5)));

        // Клиентская аналитика пишется в БД на каждый запрос — ограничиваем
        // частоту, чтобы один клиент не залил таблицу событиями.
        options.AddPolicy("analytics", ctx => IpPartition(ctx, permit: 120, window: TimeSpan.FromMinutes(1)));

        // Per-IP кап регистрации: см. комментарий к классу. GlobalLimiter
        // отрабатывает до endpoint-политики и для всех остальных путей
        // возвращает «нет лимитера».
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(RegistrationIpPartition);
    }

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
            RateLimitPartitionKeys.Identity(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(5),
                QueueLimit = 0
            });

    /// <summary>5 регистраций в час на email. Ключ — сам email, а не IP.</summary>
    public static RateLimitPartition<string> SignupPartition(HttpContext context) =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPartitionKeys.SignupEmail(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = SignupEmailPermitLimit,
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
                PermitLimit = SignupIpPermitLimit,
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
