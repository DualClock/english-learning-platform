using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

// Квоты на AI-вызовы в расчёте на пользователя за сутки (UTC) и учёт токенов.
// Счётчики кэшируются на 60 секунд, чтобы не считать COUNT на каждый запрос;
// после записи лога кэш инкрементируется сразу, чтобы всплески запросов
// не проскакивали мимо лимита.
public class AiQuotaService
{
    public const string QuotaExceededMessage =
        "Дневной лимит обращений к ИИ исчерпан. Лимит обновится в 00:00 UTC.";

    public const string GlobalBudgetExceededMessage =
        "Дневной лимит обращений к ИИ исчерпан у всего сервиса. Попробуйте завтра после 00:00 UTC.";

    // R-07: отказ по частоте запросов за минуту (отдельный от дневной квоты).
    public const string RateLimitedMessage =
        "Слишком много обращений к ИИ подряд. Подождите минуту.";

    private static readonly TimeSpan CounterCacheTtl = TimeSpan.FromSeconds(60);

    // R-07: окно частоты = одна минута; ключ счётчика содержит номер минуты,
    // поэтому запись в кэше нужна только чтобы не расти бесконечно.
    private static readonly TimeSpan RateWindowTtl = TimeSpan.FromMinutes(2);

    // Лок обязан быть статическим: AiQuotaService регистрируется как scoped,
    // и экземплярный лок не сериализовал бы параллельные запросы одного
    // пользователя между собой.
    private static readonly object RateCounterLock = new();

    // Предупреждение об исчерпании глобального бюджета пишем один раз в сутки
    // на порог (80% / 100%), чтобы не засорять журнал на каждом запросе.
    private const int GlobalBudgetWarnPercent = 80;

    private readonly ApplicationDbContext _context;
    private readonly IMemoryCache _cache;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AiQuotaService> _logger;

    public AiQuotaService(
        ApplicationDbContext context,
        IMemoryCache cache,
        IConfiguration configuration,
        ILogger<AiQuotaService> logger)
    {
        _context = context;
        _cache = cache;
        _configuration = configuration;
        _logger = logger;
    }

    public int RequestLimit => _configuration.GetValue("Ai:DailyUserRequestLimit", 300);

    public long TokenLimit => _configuration.GetValue("Ai:DailyUserTokenLimit", 300_000);

    // A6: общий дневной бюджет обращений к Gemini на весь сервис.
    // Настраивается через Ai__GlobalDailyRequestLimit, по умолчанию 2000/сутки.
    public int GlobalRequestLimit => _configuration.GetValue("Ai:GlobalDailyRequestLimit", 2000);

    // Возвращает true, если пользователь может сделать ещё один AI-вызов
    public async Task<bool> IsWithinQuotaAsync(string userId)
    {
        var (requests, tokens) = await GetTodayUsageAsync(userId);
        return requests < RequestLimit && tokens < TokenLimit;
    }

    // R-07: сколько AI-вызовов подряд разрешено одному аккаунту за минуту.
    // Дневная квота её не заменяет: счётчик дневных вызовов кэшируется на 60
    // секунд, поэтому параллельный всплеск проходит IsWithinQuotaAsync «до»
    // записи лога и успевает потратить бюджет до появления отказа.
    public int PerMinuteRequestLimit =>
        Math.Clamp(_configuration.GetValue("Ai:PerMinuteUserRequestLimit", 30), 1, 10_000);

    /// <summary>
    /// Бронирует один AI-вызов пользователя в текущей минуте UTC.
    /// False — частота превышена, к провайдеру идти нельзя.
    /// </summary>
    public bool TryReservePerMinuteRequest(string userId)
    {
        var limit = PerMinuteRequestLimit;
        var key = $"ai-rate:{userId}:{MinuteOfUtcDay(DateTime.UtcNow)}";

        // Счётчик живёт в singleton-кэше (сам AiQuotaService — scoped), иначе
        // каждый запрос начинал бы счёт с нуля. Инкремент под статической
        // блокировкой: без неё два параллельных вызова читают одно и то же
        // «used» и оба бронят слот, которого не хватает.
        lock (RateCounterLock)
        {
            var used = _cache.TryGetValue(key, out int stored) ? stored : 0;
            if (used >= limit)
            {
                return false;
            }

            _cache.Set(key, used + 1, RateWindowTtl);
            return true;
        }
    }

    public static int MinuteOfUtcDay(DateTime now) => now.Hour * 60 + now.Minute;

    // Возвращает false, когда глобальный дневной бюджет Gemini исчерпан.
    // На 80% порога — предупреждение в лог (алерт для владельца).
    public async Task<bool> IsWithinGlobalBudgetAsync()
    {
        var requests = await GetGlobalTodayRequestsAsync();
        var limit = GlobalRequestLimit;
        if (limit <= 0)
        {
            return true;
        }

        var percent = (int)(requests * 100.0 / limit);
        if (requests >= limit)
        {
            WarnOncePerDay("budget-100",
                "Глобальный дневной бюджет ИИ исчерпан: {Used}% ({Requests}/{Limit})", percent, requests, limit);
            return false;
        }

        if (percent >= GlobalBudgetWarnPercent)
        {
            WarnOncePerDay("budget-80",
                "Глобальный дневной бюджет ИИ использован на {Used}% ({Requests}/{Limit})", percent, requests, limit);
        }

        return true;
    }

    public async Task<(int Requests, long Tokens)> GetTodayUsageAsync(string userId)
    {
        var cacheKey = $"ai-usage:{userId}:{DateTime.UtcNow:yyyyMMdd}";
        if (_cache.TryGetValue(cacheKey, out (int, long) cached))
        {
            return cached;
        }

        var dayStart = DateTime.UtcNow.Date;
        var query = _context.AiUsageLogs
            .AsNoTracking()
            .Where(l => l.UserId == userId && l.CreatedAt >= dayStart);

        var requests = await query.CountAsync();
        var tokens = await query.SumAsync(l => (long?)l.TotalTokens) ?? 0;

        _cache.Set(cacheKey, (requests, tokens), CounterCacheTtl);
        return (requests, tokens);
    }

    private async Task<int> GetGlobalTodayRequestsAsync()
    {
        var cacheKey = $"ai-global-usage:{DateTime.UtcNow:yyyyMMdd}";
        if (_cache.TryGetValue(cacheKey, out int cached))
        {
            return cached;
        }

        var dayStart = DateTime.UtcNow.Date;
        var requests = await _context.AiUsageLogs
            .AsNoTracking()
            .CountAsync(l => l.CreatedAt >= dayStart);

        _cache.Set(cacheKey, requests, CounterCacheTtl);
        return requests;
    }

    // Записывает одну AI-операцию. userId может быть null (системные вызовы
    // без пользователя — анализ книги и т.п.) — тогда пишем без квоты.
    public async Task LogUsageAsync(
        string? userId,
        string requestType,
        string model,
        int promptTokens,
        int completionTokens,
        bool success)
    {
        try
        {
            _context.AiUsageLogs.Add(new AiUsageLog
            {
                UserId = userId ?? string.Empty,
                RequestType = Truncate(requestType, 50),
                Model = Truncate(model, 80),
                PromptTokens = Math.Max(0, promptTokens),
                CompletionTokens = Math.Max(0, completionTokens),
                TotalTokens = Math.Max(0, promptTokens) + Math.Max(0, completionTokens),
                Success = success,
                CreatedAt = DateTime.UtcNow
            });
            await _context.SaveChangesAsync();

            // В глобальный бюджет идут все обращения к провайдеру, включая
            // системные (userId == null): они тоже стоят денег.
            BumpCachedGlobalCounter();

            if (userId != null)
            {
                BumpCachedCounters(userId, promptTokens + completionTokens);
            }
        }
        catch (Exception ex)
        {
            // Учёт не должен ломать сам AI-запрос
            _logger.LogWarning(ex, "Failed to write AI usage log");
        }
    }

    private void BumpCachedGlobalCounter()
    {
        var cacheKey = $"ai-global-usage:{DateTime.UtcNow:yyyyMMdd}";
        var current = _cache.TryGetValue(cacheKey, out int cached) ? cached : 0;
        _cache.Set(cacheKey, current + 1, CounterCacheTtl);
    }

    private void WarnOncePerDay(string thresholdKey, string messageTemplate, params object[] args)
    {
        var warnKey = $"ai-global-warn:{thresholdKey}:{DateTime.UtcNow:yyyyMMdd}";
        if (_cache.TryGetValue(warnKey, out _))
        {
            return;
        }

        _cache.Set(warnKey, true, TimeSpan.FromHours(24));
        _logger.LogWarning(messageTemplate, args);
    }

    private void BumpCachedCounters(string userId, int totalTokens)
    {
        var cacheKey = $"ai-usage:{userId}:{DateTime.UtcNow:yyyyMMdd}";
        var (requests, tokens) = _cache.TryGetValue(cacheKey, out (int, long) current)
            ? current
            : (0, 0L);
        _cache.Set(cacheKey, (requests + 1, tokens + totalTokens), CounterCacheTtl);
    }

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];
}
