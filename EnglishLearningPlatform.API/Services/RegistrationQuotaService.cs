using EnglishLearningPlatform.API.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// W1.4.1 (SECURITY_GATE R-02/R-10): суточный кап регистраций на весь сервис.
///
/// Лимиты «5 на email в час» и «50 на IP в час» ограничивают поток запросов,
/// но не общий приток: сплэм на тысячу разных адресов с одного ботнета их
/// обходит, а закрытая бета не должна превращаться в открытую. Кап считается
/// по числу созданных за календарные сутки (UTC) пользователей — как и бюджет
/// Gemini (AiQuotaService), счётчик живёт в Postgres, поэтому переживает
/// рестарт бесплатного инстанса и одинаков на всех репликах.
///
/// На 80% порога — предупреждение в журнал (один раз в сутки, чтобы не
/// засорять его), на 100% — отказ с 429.
/// </summary>
public class RegistrationQuotaService
{
    /// <summary>Значение по умолчанию, если Registration:DailyGlobalLimit не задан.</summary>
    public const int DefaultDailyGlobalLimit = 500;

    private const int WarnPercent = 80;

    // Счётчик пересчитывается не чаще раза в минуту: регистрация — редкая
    // операция, но COUNT по пользователям на каждый запрос всё равно лишён смысла
    private static readonly TimeSpan CounterCacheTtl = TimeSpan.FromSeconds(60);

    private readonly ApplicationDbContext _context;
    private readonly IMemoryCache _cache;
    private readonly IConfiguration _configuration;
    private readonly ILogger<RegistrationQuotaService> _logger;

    public RegistrationQuotaService(
        ApplicationDbContext context,
        IMemoryCache cache,
        IConfiguration configuration,
        ILogger<RegistrationQuotaService> logger)
    {
        _context = context;
        _cache = cache;
        _configuration = configuration;
        _logger = logger;
    }

    public int DailyGlobalLimit =>
        _configuration.GetValue("Registration:DailyGlobalLimit", DefaultDailyGlobalLimit);

    /// <summary>
    /// false — суточный кап исчерпан, регистрацию надо отклонить с 429.
    /// Ноль или минус в конфиге означают «кап выключен»: на время набора
    /// владельцев можно поднять лимит, не удаляя код.
    /// </summary>
    public async Task<bool> IsWithinDailyCapAsync()
    {
        var limit = DailyGlobalLimit;
        if (limit <= 0)
        {
            return true;
        }

        var today = await GetTodayRegistrationsAsync();
        var percent = (int)(today * 100.0 / limit);

        if (today >= limit)
        {
            WarnOncePerDay("cap-100",
                "Суточный кап регистраций исчерпан: {Used}% ({Count}/{Limit}) — новые регистрации отклоняются",
                percent, today, limit);
            return false;
        }

        if (percent >= WarnPercent)
        {
            WarnOncePerDay("cap-80",
                "Суточный кап регистраций использован на {Used}% ({Count}/{Limit})",
                percent, today, limit);
        }

        return true;
    }

    private async Task<int> GetTodayRegistrationsAsync()
    {
        var cacheKey = TodayCounterKey();
        if (_cache.TryGetValue(cacheKey, out int cached))
        {
            return cached;
        }

        var dayStart = DateTime.UtcNow.Date;
        var count = await _context.Users
            .AsNoTracking()
            .CountAsync(u => u.CreatedAt >= dayStart);

        _cache.Set(cacheKey, count, CounterCacheTtl);
        return count;
    }

    /// <summary>
    /// Успешная регистрация инкрементирует счётчик сразу: без этого кап
    /// отстаёт от реальности на TTL кэша (60 с), и всплеск из полутора сотен
    /// параллельных запросов прошёл бы мимо него.
    /// </summary>
    public void OnRegistrationCreated()
    {
        var cacheKey = TodayCounterKey();
        var current = _cache.TryGetValue(cacheKey, out int cached) ? cached : 0;
        _cache.Set(cacheKey, current + 1, CounterCacheTtl);
    }

    private static string TodayCounterKey() => $"registrations-today:{DateTime.UtcNow:yyyyMMdd}";

    private void WarnOncePerDay(string thresholdKey, string messageTemplate, params object[] args)
    {
        var warnKey = $"registration-cap-warn:{thresholdKey}:{DateTime.UtcNow:yyyyMMdd}";
        if (_cache.TryGetValue(warnKey, out _))
        {
            return;
        }

        _cache.Set(warnKey, true, TimeSpan.FromHours(24));
        _logger.LogWarning(messageTemplate, args);
    }
}
