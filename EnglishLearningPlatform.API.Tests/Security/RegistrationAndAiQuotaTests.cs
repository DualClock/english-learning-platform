using System.Security.Claims;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Middleware;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Security;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// A6 (SECURITY_GATE 1.5): открытая регистрация + 300 AI-запросов/день на
/// аккаунт = disposable-аккаунты выжигают Gemini-бюджет. Доступ к AI-эндпоинтам
/// только с подтверждённым email; глобальный дневной бюджет обращений к Gemini;
/// honeypot на регистрации.
/// </summary>
public class EmailConfirmationGateTests
{
    private static ServiceProvider BuildProvider(params User[] users)
    {
        // Имя базы фиксируется ВНЕ лямбды: AddDbContext переоценивает опции
        // на каждый скоуп, Guid внутри лямбды дал бы каждому скоупу новую
        // пустую базу и сид никогда бы не был виден фильтру.
        var dbName = Guid.NewGuid().ToString();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<ApplicationDbContext>(options =>
        {
            options.UseInMemoryDatabase(dbName);
        });

        var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        db.Users.AddRange(users);
        db.SaveChanges();
        return provider;
    }

    private static ActionExecutingContext ActionContextFor(ServiceProvider provider, User user)
    {
        var httpContext = new DefaultHttpContext { RequestServices = provider };
        httpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id)
        }, "test"));

        var actionContext = new ActionContext(httpContext, new Microsoft.AspNetCore.Routing.RouteData(), new ActionDescriptor());
        return new ActionExecutingContext(
            actionContext,
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            controller: null!);
    }

    private static User MakeUser(string id, bool confirmed) => new()
    {
        Id = id,
        UserName = $"{id}@example.com",
        Email = $"{id}@example.com",
        EmailConfirmed = confirmed
    };

    [Fact]
    public async Task UnconfirmedEmail_Gets403WithCode()
    {
        using var provider = BuildProvider(MakeUser("u-unconfirmed", confirmed: false));
        var context = ActionContextFor(provider, MakeUser("u-unconfirmed", false));

        var nextCalled = false;
        await new RequireConfirmedEmailAttribute().OnActionExecutionAsync(context, () =>
        {
            nextCalled = true;
            return Task.FromResult(new ActionExecutedContext(context, new List<IFilterMetadata>(), controller: null!));
        });

        Assert.False(nextCalled);
        var result = Assert.IsType<ObjectResult>(context.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, result.StatusCode);
        var payload = Assert.IsType<EmailConfirmationRequiredResult>(result.Value);
        Assert.Equal("email_confirmation_required", payload.Error);
    }

    [Fact]
    public async Task ConfirmedEmail_ActionRuns()
    {
        using var provider = BuildProvider(MakeUser("u-confirmed", confirmed: true));
        var context = ActionContextFor(provider, MakeUser("u-confirmed", true));

        var nextCalled = false;
        await new RequireConfirmedEmailAttribute().OnActionExecutionAsync(context, () =>
        {
            nextCalled = true;
            return Task.FromResult(new ActionExecutedContext(context, new List<IFilterMetadata>(), controller: null!));
        });

        Assert.True(nextCalled);
        Assert.Null(context.Result);
    }

    [Fact]
    public async Task MissingUserInDb_Gets403()
    {
        using var provider = BuildProvider();
        var context = ActionContextFor(provider, MakeUser("u-ghost", confirmed: true));

        await new RequireConfirmedEmailAttribute().OnActionExecutionAsync(context, () =>
            Task.FromResult(new ActionExecutedContext(context, new List<IFilterMetadata>(), controller: null!)));

        var result = Assert.IsType<ObjectResult>(context.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, result.StatusCode);
    }

    // W1.4.3: здесь был тест `AiControllersAreMarkedWithRequireConfirmedEmail`,
    // который перебирал захардкоженный список из четырёх типов. Именно он
    // «зеленел», когда BooksController /parallel остался без гейта: нового
    // эндпоинта в списке не было и быть не могло. Его место занял
    // AiEndpointGateTests — он выводит AI-достижимые экшены из графа
    // зависимостей, а не из списка.
}

/// <summary>Глобальный дневной бюджет Gemini: 80% — предупреждение, 100% — отказ.</summary>
public class AiGlobalBudgetTests
{
    private sealed record Harness(AiQuotaService Quota, ApplicationDbContext Db, ListLogger Logger);

    private sealed class ListLogger : ILogger,
        ILogger<AiQuotaService>, ILogger<ResilientAiService>, ILogger<GlobalExceptionHandler>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Entries.Add((logLevel, formatter(state, exception)));
    }

    private static Harness Create(int globalLimit, int seededToday)
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new ApplicationDbContext(options);

        var dayStart = DateTime.UtcNow.Date;
        for (var i = 0; i < seededToday; i++)
        {
            db.AiUsageLogs.Add(new AiUsageLog { UserId = "sys", RequestType = "t", Model = "m", CreatedAt = dayStart.AddMinutes(i) });
        }

        db.SaveChanges();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ai:GlobalDailyRequestLimit"] = globalLimit.ToString()
            })
            .Build();

        var logger = new ListLogger();
        var quota = new AiQuotaService(db, new MemoryCache(new MemoryCacheOptions()), configuration, logger);
        return new Harness(quota, db, logger);
    }

    [Fact]
    public async Task GlobalBudget_BelowLimit_Allows()
    {
        var harness = Create(globalLimit: 10, seededToday: 7);
        Assert.True(await harness.Quota.IsWithinGlobalBudgetAsync());
    }

    [Fact]
    public async Task GlobalBudget_AtOrAboveLimit_Denies()
    {
        var harness = Create(globalLimit: 10, seededToday: 10);
        Assert.False(await harness.Quota.IsWithinGlobalBudgetAsync());
    }

    [Fact]
    public async Task GlobalBudget_EightyPercent_LogsWarning()
    {
        var harness = Create(globalLimit: 10, seededToday: 8);
        Assert.True(await harness.Quota.IsWithinGlobalBudgetAsync());
        Assert.Contains(harness.Logger.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("80"));
    }

    [Fact]
    public async Task GlobalBudget_LogUsageCountsTowardBudget()
    {
        var harness = Create(globalLimit: 3, seededToday: 0);
        for (var i = 0; i < 3; i++)
        {
            await harness.Quota.LogUsageAsync("u1", "chat", "gemini-test", 1, 1, success: true);
        }

        Assert.False(await harness.Quota.IsWithinGlobalBudgetAsync());
    }

    [Fact]
    public async Task ResilientAiService_GlobalBudgetExceeded_Throws429Exception_BeforeAnyHttpCall()
    {
        var harness = Create(globalLimit: 2, seededToday: 2);

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddMemoryCache();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Ai:GlobalDailyRequestLimit"] = "2" })
            .Build());
        services.AddScoped<AiQuotaService>(sp => new AiQuotaService(
            harness.Db,
            sp.GetRequiredService<IMemoryCache>(),
            sp.GetRequiredService<IConfiguration>(),
            new ListLogger()));
        var provider = services.BuildServiceProvider();

        var httpCalled = false;
        var client = new HttpClient(new DelegatingHandlerStub(() =>
        {
            httpCalled = true;
            return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK));
        }));

        var service = new ResilientAiService(
            provider.GetRequiredService<IConfiguration>(),
            new ListLogger(),
            httpClient: client,
            retryDelays: Array.Empty<TimeSpan>(),
            scopeFactory: provider.CreateScope().ServiceProvider.GetRequiredService<IServiceScopeFactory>());

        await Assert.ThrowsAsync<AiGlobalBudgetExceededException>(
            () => service.SendAsync("gemini-test", new { }, "key", "chat", userId: "u1"));
        Assert.False(httpCalled);
    }

    [Fact]
    public async Task GlobalExceptionHandler_MapsBudgetExceeded_To429()
    {
        var context = new DefaultHttpContext();
        var services = new ServiceCollection();
        services.AddProblemDetails();
        services.AddLogging();
        context.RequestServices = services.BuildServiceProvider();

        var handler = new GlobalExceptionHandler(
            new ListLogger(),
            new TestWebHostEnvironment());

        var handled = await handler.TryHandleAsync(context, new AiGlobalBudgetExceededException(), CancellationToken.None);

        Assert.True(handled);
        Assert.Equal(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
    }

    private sealed class DelegatingHandlerStub : DelegatingHandler
    {
        private readonly Func<Task<HttpResponseMessage>> _factory;
        public DelegatingHandlerStub(Func<Task<HttpResponseMessage>> factory) => _factory = factory;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => _factory();
    }
}

/// <summary>Honeypot на регистрации: заполненное невидимое поле = бот.</summary>
public class RegistrationHoneypotTests
{
    private static AuthController CreateController(out UserManager<User> userManager)
    {
        // Имя базы фиксировано: AddDbContext переоценивает лямбду опций на
        // каждый скоуп, поэтому Guid внутри лямбды дал бы каждому скоупу
        // свою пустую базу.
        var dbName = Guid.NewGuid().ToString();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDataProtection();
        services.AddDbContext<ApplicationDbContext>(options => options.UseInMemoryDatabase(dbName));
        services.AddIdentityCore<User>(options =>
        {
            options.Password.RequireDigit = true;
            options.Password.RequireLowercase = true;
            options.Password.RequireUppercase = true;
            options.Password.RequireNonAlphanumeric = false;
            options.Password.RequiredLength = 6;
        })
            .AddEntityFrameworkStores<ApplicationDbContext>();
        var provider = services.BuildServiceProvider();
        userManager = provider.GetRequiredService<UserManager<User>>();
        var db = provider.GetRequiredService<ApplicationDbContext>();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-secret-key-for-honeypot-tests-32",
                ["Jwt:Issuer"] = "TestIssuer",
                ["Jwt:Audience"] = "TestAudience",
                ["Jwt:ExpiryMinutes"] = "60"
            })
            .Build();

        var emailSender = new EmailSender(db, configuration, Microsoft.Extensions.Logging.Abstractions.NullLogger<EmailSender>.Instance);
        var authEmail = new AuthEmailService(emailSender, configuration);
        var cache = new MemoryCache(new MemoryCacheOptions());
        return new AuthController(
            userManager, configuration, authEmail,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<AuthController>.Instance,
            cache,
            new RegistrationQuotaService(db, cache, configuration, Microsoft.Extensions.Logging.Abstractions.NullLogger<RegistrationQuotaService>.Instance));
    }

    [Fact]
    public async Task Register_WithHoneypotFilled_IsRejected_AndNoUserCreated()
    {
        var controller = CreateController(out var userManager);

        var result = await controller.Register(new RegisterDto(
            "bot@example.com",
            "Password1",
            DisplayName: null,
            CefrLevel: null,
            StudyGoal: null,
            DailyGoalMinutes: null,
            Website: "https://spam.example"));

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Null(await userManager.FindByEmailAsync("bot@example.com"));
    }

    [Fact]
    public async Task Register_WithoutHoneypot_StillSucceeds()
    {
        var controller = CreateController(out var userManager);

        var result = await controller.Register(new RegisterDto(
            "human@example.com",
            "Password1",
            DisplayName: "Human",
            CefrLevel: null,
            StudyGoal: null,
            DailyGoalMinutes: null));

        Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(await userManager.FindByEmailAsync("human@example.com"));
    }
}
