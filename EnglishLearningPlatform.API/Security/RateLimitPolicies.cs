using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace EnglishLearningPlatform.API.Security;

/// <summary>
/// Политики rate limiting вынесены из Program.cs, чтобы партицирование
/// проверялось юнит-тестами без поднятия всего хоста.
/// auth — 10/мин на связку IP+email; admin — 10/5 мин там же;
/// signup — 5/час на IP (регистрация не требует email-пары);
/// feedback/upload/analytics — по IP, как были.
/// </summary>
public static class RateLimitPolicies
{
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

    public static RateLimitPartition<string> SignupPartition(HttpContext context) =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPartitionKeys.IpOnly(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromHours(1),
                QueueLimit = 0
            });

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
