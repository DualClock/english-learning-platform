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

    private static readonly TimeSpan CounterCacheTtl = TimeSpan.FromSeconds(60);

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

    // Возвращает true, если пользователь может сделать ещё один AI-вызов
    public async Task<bool> IsWithinQuotaAsync(string userId)
    {
        var (requests, tokens) = await GetTodayUsageAsync(userId);
        return requests < RequestLimit && tokens < TokenLimit;
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
