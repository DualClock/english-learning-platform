using System.Net;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Middleware;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// R-07: ни на одном AI-эндпоинте не было политики частоты. Единственный
/// тормоз — дневная квота AiQuotaService, а она мягкая: счётчик читается из
/// Postgres и кэшируется на 60 секунд, между «проверили» и «записали» нет
/// атомарности. Один аккаунт в параллельном всплеске сжигает суточный бюджет
/// провайдера за секунды, а на 80 реплике лимит вообще не ограничен ничем,
/// кроме адреса прокси (который сейчас общий на всех).
/// Ограничитель частоты поставлен в единственную точку, где уходят деньги —
/// ResilientAiService.SendAsync, — поэтому он закрывает все пути сразу,
/// включая транзитивные вызовы из BooksController.
/// </summary>
public class AiRateLimitTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"candidates":[{"content":{"parts":[{"text":"{}"}]}}]}""",
                    System.Text.Encoding.UTF8, "application/json")
            });
        }
    }

    private static (AiQuotaService Quota, IMemoryCache Cache) CreateQuota(int perMinuteLimit)
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ai:PerMinuteUserRequestLimit"] = perMinuteLimit.ToString()
            })
            .Build();

        var cache = new MemoryCache(new MemoryCacheOptions());
        return (new AiQuotaService(new ApplicationDbContext(options), cache, configuration,
            NullLogger<AiQuotaService>.Instance), cache);
    }

    [Fact]
    public void PerMinuteBudget_DeniesTheBurstBeyondTheLimit()
    {
        var (quota, _) = CreateQuota(perMinuteLimit: 3);

        var granted = 0;
        for (var i = 0; i < 10; i++)
        {
            if (quota.TryReservePerMinuteRequest("u-burst")) granted++;
        }

        Assert.Equal(3, granted);
    }

    [Fact]
    public void PerMinuteBudget_IsCountedPerUser()
    {
        var (quota, _) = CreateQuota(perMinuteLimit: 2);

        Assert.True(quota.TryReservePerMinuteRequest("u-first"));
        Assert.True(quota.TryReservePerMinuteRequest("u-first"));
        Assert.False(quota.TryReservePerMinuteRequest("u-first"));

        // Второй пользователь не сидит в корзине первого: партичность по
        // аутентифицированному userId, а не по IP за прокси.
        Assert.True(quota.TryReservePerMinuteRequest("u-second"));
    }

    [Fact]
    public void PerMinuteBudget_RollsOverAtTheMinuteBoundary()
    {
        // Счётчик привязан к номеру минуты в сутках, а не к «вечному» ключу:
        // иначе лимит превратился бы в пожизненную блокировку аккаунта.
        Assert.Equal(600, AiQuotaService.MinuteOfUtcDay(new DateTime(2026, 1, 1, 10, 0, 0, DateTimeKind.Utc)));
        Assert.Equal(601, AiQuotaService.MinuteOfUtcDay(new DateTime(2026, 1, 1, 10, 1, 0, DateTimeKind.Utc)));

        var justBefore = AiQuotaService.MinuteOfUtcDay(new DateTime(2026, 1, 1, 10, 0, 59, DateTimeKind.Utc));
        var justAfter = AiQuotaService.MinuteOfUtcDay(new DateTime(2026, 1, 1, 10, 1, 1, DateTimeKind.Utc));
        Assert.NotEqual(justBefore, justAfter);
    }

    [Fact]
    public async Task ResilientAiService_PerMinuteBudgetExhausted_RefusesBeforeCallingProvider()
    {
        const string model = "gemini-test";
        var dbOptions = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new ApplicationDbContext(dbOptions);

        var services = new ServiceCollection();
        services.AddMemoryCache();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ai:PerMinuteUserRequestLimit"] = "2",
                ["Ai:GlobalDailyRequestLimit"] = "1000",
                ["Ai:DailyUserRequestLimit"] = "1000"
            })
            .Build());
        services.AddScoped<AiQuotaService>(sp => new AiQuotaService(
            db,
            sp.GetRequiredService<IMemoryCache>(),
            sp.GetRequiredService<IConfiguration>(),
            NullLogger<AiQuotaService>.Instance));
        var provider = services.BuildServiceProvider();

        var handler = new StubHandler();
        var resilient = new ResilientAiService(
            provider.GetRequiredService<IConfiguration>(),
            NullLogger<ResilientAiService>.Instance,
            httpClient: new HttpClient(handler),
            retryDelays: Array.Empty<TimeSpan>(),
            scopeFactory: provider.GetRequiredService<IServiceScopeFactory>());

        await resilient.SendAsync(model, new { }, "key", "translate", userId: "u1");
        await resilient.SendAsync(model, new { }, "key", "translate", userId: "u1");

        var thrown = await Assert.ThrowsAsync<AiRateLimitExceededException>(
            () => resilient.SendAsync(model, new { }, "key", "translate", userId: "u1"));

        // Провайдер не должен вызываться лишние разы: отказ дешевле запроса.
        Assert.Equal(2, handler.CallCount);
        Assert.Contains("минут", thrown.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GlobalExceptionHandler_MapsPerMinuteLimit_To429WithRetryAfter()
    {
        var context = new DefaultHttpContext();
        var services = new ServiceCollection();
        services.AddProblemDetails();
        services.AddLogging();
        context.RequestServices = services.BuildServiceProvider();

        var handler = new GlobalExceptionHandler(
            NullLogger<GlobalExceptionHandler>.Instance,
            new TestWebHostEnvironment());

        var handled = await handler.TryHandleAsync(
            context, new AiRateLimitExceededException(), CancellationToken.None);

        Assert.True(handled);
        Assert.Equal(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
        Assert.Equal("60", context.Response.Headers["Retry-After"]);
    }
}
