using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// W1.4.1 (SECURITY_GATE R-02/R-10): глобальный суточный кап регистраций.
///
/// Почасовые лимиты по email (5) и по IP (50) ограничивают поток, но сплэм на
/// тысячу разных адресов проходит мимо обоих. Кап по числу созданных за сутки
/// пользователей — единственный тормоз для «одновременной» регистрации всей
/// беты, поэтому он считается не в памяти процесса, а по БД: бесплатный
/// инстанс Render засыпает и перезапускается, и in-memory счётчик обнулился бы
/// вместе с ним.
/// </summary>
public class RegistrationDailyCapTests
{
    private sealed record Harness(RegistrationQuotaService Quota, ApplicationDbContext Db, ListLogger Logger);

    private sealed class ListLogger : ILogger, ILogger<RegistrationQuotaService>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Entries.Add((logLevel, formatter(state, exception)));
    }

    private static Harness Create(int? configuredLimit, int seededToday, int seededYesterday = 0)
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new ApplicationDbContext(options);

        var today = DateTime.UtcNow.Date;
        var yesterday = today.AddDays(-1);
        for (var i = 0; i < seededToday; i++)
        {
            db.Users.Add(new User { Id = $"u-today-{i}", UserName = $"t{i}@example.com", Email = $"t{i}@example.com", CreatedAt = today.AddMinutes(i) });
        }

        for (var i = 0; i < seededYesterday; i++)
        {
            db.Users.Add(new User { Id = $"u-yest-{i}", UserName = $"y{i}@example.com", Email = $"y{i}@example.com", CreatedAt = yesterday.AddMinutes(i) });
        }

        db.SaveChanges();

        var values = new Dictionary<string, string?>();
        if (configuredLimit.HasValue)
        {
            values["Registration:DailyGlobalLimit"] = configuredLimit.Value.ToString();
        }

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var logger = new ListLogger();
        var quota = new RegistrationQuotaService(db, new MemoryCache(new MemoryCacheOptions()), configuration, logger);
        return new Harness(quota, db, logger);
    }

    [Fact]
    public async Task BelowCap_Allows()
    {
        var harness = Create(configuredLimit: 10, seededToday: 7);
        Assert.True(await harness.Quota.IsWithinDailyCapAsync());
    }

    [Fact]
    public async Task AtCap_Denies()
    {
        var harness = Create(configuredLimit: 10, seededToday: 10);
        Assert.False(await harness.Quota.IsWithinDailyCapAsync());
    }

    [Fact]
    public async Task EightyPercent_LogsWarning_ButStillAllows()
    {
        var harness = Create(configuredLimit: 10, seededToday: 8);

        Assert.True(await harness.Quota.IsWithinDailyCapAsync());
        Assert.Contains(harness.Logger.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("80"));
    }

    [Fact]
    public async Task ExhaustedCap_LogsWarningOncePerDay()
    {
        var harness = Create(configuredLimit: 5, seededToday: 5);

        Assert.False(await harness.Quota.IsWithinDailyCapAsync());
        Assert.False(await harness.Quota.IsWithinDailyCapAsync());
        Assert.False(await harness.Quota.IsWithinDailyCapAsync());

        Assert.Single(harness.Logger.Entries, e => e.Level == LogLevel.Warning);
    }

    [Fact]
    public async Task YesterdayRegistrations_DoNotConsumeTodaysCap()
    {
        // Вчерашние аккаунты не должны закрывать регистрацию сегодня:
        // кап именно суточный, а не «всего пользователей»
        var harness = Create(configuredLimit: 10, seededToday: 3, seededYesterday: 40);
        Assert.True(await harness.Quota.IsWithinDailyCapAsync());
    }

    [Fact]
    public async Task MissingConfig_UsesDocumentedDefaultOfFiveHundred()
    {
        var harness = Create(configuredLimit: null, seededToday: 499);

        Assert.Equal(RegistrationQuotaService.DefaultDailyGlobalLimit, harness.Quota.DailyGlobalLimit);
        Assert.Equal(500, harness.Quota.DailyGlobalLimit);
        Assert.True(await harness.Quota.IsWithinDailyCapAsync());
    }

    [Fact]
    public async Task ZeroCap_DisablesTheLimit_WithoutDisablingTheCode()
    {
        var harness = Create(configuredLimit: 0, seededToday: 40);
        Assert.True(await harness.Quota.IsWithinDailyCapAsync());
    }

    [Fact]
    public async Task CreatedRegistration_TightensTheCapWithoutWaitingForCacheTtl()
    {
        // Счётчик кэшируется на минуту; если бы кап ждал TTL, всплеск из
        // полутора сотен параллельных регистраций прошёл бы мимо него
        var harness = Create(configuredLimit: 2, seededToday: 0);
        Assert.True(await harness.Quota.IsWithinDailyCapAsync());

        harness.Quota.OnRegistrationCreated();
        Assert.True(await harness.Quota.IsWithinDailyCapAsync());

        harness.Quota.OnRegistrationCreated();
        Assert.False(await harness.Quota.IsWithinDailyCapAsync());
    }
}

/// <summary>
/// Кап должен отказывать именно на регистрации: 429 и ни одной строки в Users.
/// </summary>
public class RegistrationDailyCapEnforcementTests
{
    private const string Password = "Password1";

    private static (AuthController Controller, UserManager<User> Users, ApplicationDbContext Db) CreateController(
        int dailyLimit,
        int alreadyRegisteredToday)
    {
        // Имя базы фиксируется ВНЕ лямбды опций: AddDbContext переоценивает
        // лямбду на каждый скоуп, и Guid внутри дал бы каждому скоупу свою базу.
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
        var userManager = provider.GetRequiredService<UserManager<User>>();
        var db = provider.GetRequiredService<ApplicationDbContext>();

        var dayStart = DateTime.UtcNow.Date;
        for (var i = 0; i < alreadyRegisteredToday; i++)
        {
            db.Users.Add(new User
            {
                Id = $"seed-{i}",
                UserName = $"seed{i}@example.com",
                Email = $"seed{i}@example.com",
                CreatedAt = dayStart.AddMinutes(i)
            });
        }

        db.SaveChanges();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-secret-key-for-daily-cap-tests-32",
                ["Jwt:Issuer"] = "TestIssuer",
                ["Jwt:Audience"] = "TestAudience",
                ["Jwt:ExpiryMinutes"] = "60",
                ["Registration:DailyGlobalLimit"] = dailyLimit.ToString()
            })
            .Build();

        var cache = new MemoryCache(new MemoryCacheOptions());
        var emailSender = new EmailSender(db, configuration, NullLogger<EmailSender>.Instance);
        var quota = new RegistrationQuotaService(
            db, cache, configuration, NullLogger<RegistrationQuotaService>.Instance);

        var controller = new AuthController(
            userManager,
            configuration,
            new AuthEmailService(emailSender, configuration),
            NullLogger<AuthController>.Instance,
            cache,
            quota);

        return (controller, userManager, db);
    }

    [Fact]
    public async Task Register_WhenCapExhausted_Returns429_AndCreatesNobody()
    {
        var (controller, userManager, db) = CreateController(dailyLimit: 3, alreadyRegisteredToday: 3);

        var result = await controller.Register(new RegisterDto(
            "late@example.com", Password, null, null, null, null));

        var denied = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, denied.StatusCode);
        Assert.Null(await userManager.FindByEmailAsync("late@example.com"));
        Assert.Equal(0, db.Users.Count(u => u.Email == "late@example.com"));
    }

    [Fact]
    public async Task Register_WhenCapNotReached_StillSucceeds()
    {
        var (controller, userManager, _) = CreateController(dailyLimit: 500, alreadyRegisteredToday: 120);

        var result = await controller.Register(new RegisterDto(
            "pupil@example.com", Password, null, null, null, null));

        Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(await userManager.FindByEmailAsync("pupil@example.com"));
    }

    [Fact]
    public async Task Register_HoneypotIsChecked_BeforeTheDailyCap()
    {
        // Порядок имеет значение: бот с заполненным honeypot не должен съедать
        // дневной бюджет попыток и не должен трогать счётчик кап
        var (controller, _, db) = CreateController(dailyLimit: 2, alreadyRegisteredToday: 2);

        var result = await controller.Register(new RegisterDto(
            "bot@example.com", Password, null, null, null, null, Website: "https://spam.example"));

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(2, db.Users.Count());
    }
}
