using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// W2.1 — напоминания включены у нового аккаунта по умолчанию.
///
/// Почему это не косметика: у беты нет ни одного другого канала возврата. Письмо
/// подтверждения не отправляется (нет SMTP-пароля), пуш не запрашивается, а
/// единственная рассылка, которая вообще работает, — эта. Регистрация, которая
/// молча ставит NotifyEnabled=false, оставляет человека без причины вернуться на
/// второй день, и в воронке это выглядит как «продукт не удержал».
///
/// Проверяем на настоящей реляционной базе, а не на in-memory-провайдере: смысл
/// теста в том, что значение ДОШЛО до строки AspNetUsers. In-memory не применил
/// бы NOT NULL/дефолты схемы и позволил бы тесту быть зелёным при сломанном
/// маппинге.
/// </summary>
public sealed class RegistrationNotifyHarness : IAsyncDisposable
{
    public SqliteConnection Connection { get; } = new("DataSource=:memory:");
    public ApplicationDbContext Context { get; private set; } = null!;
    public AuthController Auth { get; private set; } = null!;
    private MemoryCache Cache { get; } = new(new MemoryCacheOptions());

    public async Task<User> RegisterAsync(RegisterDto dto)
    {
        var result = await Auth.Register(dto);

        if (result is not OkObjectResult)
        {
            var detail = result is ObjectResult objectResult
                ? $"{objectResult.StatusCode} {System.Text.Json.JsonSerializer.Serialize(objectResult.Value)}"
                : result.GetType().Name;
            Assert.Fail($"ожидалась успешная регистрация, получен {detail}");
        }

        // Читаем из базы заново, а не из ответа контроллера: тест про то, что
        // лежит в строке пользователя, а не про то, что попало в JSON ответа.
        Context.ChangeTracker.Clear();
        var saved = await Context.Users.SingleOrDefaultAsync(u => u.Email == dto.Email);
        Assert.NotNull(saved);
        return saved!;
    }

    public async ValueTask DisposeAsync()
    {
        await Connection.DisposeAsync();
        Cache.Dispose();
    }

    public static async Task<RegistrationNotifyHarness> CreateAsync()
    {
        var harness = new RegistrationNotifyHarness();
        await harness.Connection.OpenAsync();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDataProtection();
        services.AddDbContext<ApplicationDbContext>(options => options.UseSqlite(harness.Connection));
        services.AddIdentityCore<User>(options =>
            {
                options.Password.RequiredLength = 6;
                options.Password.RequireNonAlphanumeric = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireDigit = false;
            })
            .AddEntityFrameworkStores<ApplicationDbContext>()
            .AddDefaultTokenProviders();

        var provider = services.BuildServiceProvider();
        var context = provider.GetRequiredService<ApplicationDbContext>();
        await context.Database.EnsureCreatedAsync();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-secret-key-for-notify-tests-32chars",
                ["Jwt:Issuer"] = "TestIssuer",
                ["Jwt:Audience"] = "TestAudience",
                ["Jwt:ExpiryMinutes"] = "60",
                ["Registration:DailyGlobalLimit"] = "500",
                ["Email:From"] = "no-reply@lexicon.local",
                ["App:FrontendUrl"] = "http://localhost:3000",
            })
            .Build();

        var cache = harness.Cache;
        var userManager = provider.GetRequiredService<UserManager<User>>();
        var emailSender = new EmailSender(context, configuration, NullLogger<EmailSender>.Instance);

        harness.Context = context;
        harness.Auth = new AuthController(
            userManager,
            configuration,
            new AuthEmailService(emailSender, configuration),
            NullLogger<AuthController>.Instance,
            cache,
            new RegistrationQuotaService(context, cache, configuration, NullLogger<RegistrationQuotaService>.Instance));

        return harness;
    }
}

public class RegistrationNotifyTests
{
    /// <summary>
    /// Онбординг ещё не всегда присылает поле: старый клиент, прямой вызов API,
    /// мобильный клиент. Отсутствие поля означает «человек не отказывался» —
    /// значит, напоминание включено.
    /// </summary>
    [Fact]
    public async Task Register_WithoutNotifyField_LeavesNotificationsOn()
    {
        await using var harness = await RegistrationNotifyHarness.CreateAsync();

        var user = await harness.RegisterAsync(new RegisterDto(
            "quiet-default@example.com",
            "Password1",
            DisplayName: "Без поля",
            CefrLevel: "a2",
            StudyGoal: "travel",
            DailyGoalMinutes: 15));

        Assert.True(user.NotifyEnabled);
    }

    /// <summary>
    /// Явный отказ обязан пережить регистрацию: иначе человека, снявшего галочку,
    /// начнут рассылать — это уже не дефолт, а нарушенное обещание.
    /// </summary>
    [Fact]
    public async Task Register_WithNotifyDisabled_StaysOff()
    {
        await using var harness = await RegistrationNotifyHarness.CreateAsync();

        var user = await harness.RegisterAsync(new RegisterDto(
            "quiet-off@example.com",
            "Password1",
            DisplayName: null,
            CefrLevel: null,
            StudyGoal: null,
            DailyGoalMinutes: null,
            NotifyEnabled: false));

        Assert.False(user.NotifyEnabled);
    }

    [Fact]
    public async Task Register_WithNotifyEnabled_StaysOn()
    {
        await using var harness = await RegistrationNotifyHarness.CreateAsync();

        var user = await harness.RegisterAsync(new RegisterDto(
            "quiet-on@example.com",
            "Password1",
            DisplayName: null,
            CefrLevel: null,
            StudyGoal: null,
            DailyGoalMinutes: null,
            NotifyEnabled: true));

        Assert.True(user.NotifyEnabled);
    }

    /// <summary>
    /// Время и часовой пояс напоминания — часть того же обещания «напомним»:
    /// включённый флаг с неопределённым временем превращает рассылку в шум
    /// посреди ночи. Фиксируем дефолт, чтобы он не разъехался с текстом
    /// онбординга «напомним в 9:00 по вашему часовому поясу».
    /// </summary>
    [Fact]
    public async Task Register_WithoutReminderFields_DefaultsToNineOClock()
    {
        await using var harness = await RegistrationNotifyHarness.CreateAsync();

        var user = await harness.RegisterAsync(new RegisterDto(
            "quiet-hour@example.com",
            "Password1",
            DisplayName: null,
            CefrLevel: null,
            StudyGoal: null,
            DailyGoalMinutes: null));

        Assert.True(user.NotifyEnabled);
        Assert.Equal(9, user.ReminderHour);
    }
}
