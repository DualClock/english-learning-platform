using System.Security.Claims;
using System.Text.Json;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Tests.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// W2.1.5 — сквозная проверка обещания из писем: «своя ссылка, по которой вы
/// увидите, кто зарегистрировался».
///
/// Отдельные куски (нормализация, однократность события, ключ доступа) покрыты
/// своими тестами. Здесь же проверяется весь путь целиком, как его увидит
/// менеджер через неделю: человек пришёл по ссылке учителя → зарегистрировался →
/// открыл главу → и именно эта строка лежит в выгрузке. Если хотя бы один шарнир
/// отвалится (метка не долетела до БД, событие не записано, отчёт не стыкует
/// пользователя с событием), тест падает.
/// </summary>
public class AcquisitionEndToEndTests
{
    private const string AdminKey = "admin-secret";
    private const string Password = "Password1";

    private sealed record Harness(
        ApplicationDbContext Context,
        AuthController Auth,
        AnalyticsController Analytics,
        UserManager<User> UserManager);

    private static Harness CreateHarness()
    {
        // Одна и та же база для регистрации и для отчёта: смысл теста в том,
        // что значение, записанное при создании аккаунта, доезжает до выгрузки.
        var dbName = Guid.NewGuid().ToString();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDataProtection();
        services.AddDbContext<ApplicationDbContext>(options => options.UseInMemoryDatabase(dbName));
        services.AddIdentityCore<User>(options =>
        {
            options.Password.RequiredLength = 6;
            options.Password.RequireDigit = false;
            options.Password.RequireLowercase = false;
            options.Password.RequireUppercase = false;
            options.Password.RequireNonAlphanumeric = false;
        })
            .AddEntityFrameworkStores<ApplicationDbContext>();

        var provider = services.BuildServiceProvider();
        var userManager = provider.GetRequiredService<UserManager<User>>();
        var context = provider.GetRequiredService<ApplicationDbContext>();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-secret-key-for-acquisition-e2e-tests-32",
                ["Jwt:Issuer"] = "TestIssuer",
                ["Jwt:Audience"] = "TestAudience",
                ["Jwt:ExpiryMinutes"] = "60",
                ["Seeder:Key"] = AdminKey
            })
            .Build();

        var emailSender = new EmailSender(context, configuration, NullLogger<EmailSender>.Instance);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var auth = new AuthController(
            userManager,
            configuration,
            new AuthEmailService(emailSender, configuration),
            NullLogger<AuthController>.Instance,
            cache,
            new RegistrationQuotaService(context, cache, configuration, NullLogger<RegistrationQuotaService>.Instance));

        var analytics = new AnalyticsController(
            context,
            NullLogger<AnalyticsController>.Instance,
            configuration,
            new TestWebHostEnvironment());

        return new Harness(context, auth, analytics, userManager);
    }

    private static AnalyticsController SignedInAs(AnalyticsController controller, string userId)
    {
        // /api/analytics/event требует пользователя из JWT — в тестах подставляем
        // тот же ClaimsPrincipal, что собирает middleware.
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    new[] { new Claim(ClaimTypes.NameIdentifier, userId) },
                    authenticationType: "Test"))
            }
        };
        return controller;
    }

    [Fact]
    public async Task RefLinkRegistration_OpenedChapter_AppearsAsActivatedRow()
    {
        var harness = CreateHarness();

        // 1. Учитель Стася раздала ссылку https://домен/t/stasya → фронтенд принёс ref
        var registered = await harness.Auth.Register(new RegisterDto(
            "pupil@example.com",
            Password,
            DisplayName: null,
            CefrLevel: null,
            StudyGoal: null,
            DailyGoalMinutes: null,
            Ref: "Stasya"));

        Assert.IsType<OkObjectResult>(registered);
        var user = await harness.UserManager.FindByEmailAsync("pupil@example.com");
        Assert.NotNull(user);

        // 2. Читалка сообщила об активации
        var tracked = await SignedInAs(harness.Analytics, user!.Id)
            .Track(new AnalyticsEventDto { Event = AnalyticsController.FirstChapterEvent, Meta = "Alice in Wonderland" });

        Assert.IsType<OkResult>(tracked);

        // 3. Менеджер смотрит выгрузку
        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await harness.Analytics.Acquisition(AdminKey)).Value!;

        Assert.Single(report.Rows);
        var row = report.Rows[0];
        Assert.Equal(user!.CreatedAt.ToString("yyyy-MM-dd"), row.Date);
        Assert.Equal("stasya", row.Source);
        Assert.Equal("stasya", row.Code);
        Assert.Equal(1, row.Registrations);
        Assert.Equal(1, row.Activated);

        Assert.Equal(1, report.Totals.Registrations);
        Assert.Equal(1, report.Totals.Activated);

        var channel = report.ByChannel.Single();
        Assert.Equal("stasya", channel.Source);
        Assert.Equal(1, channel.Activated);
    }

    [Fact]
    public async Task SecondChapterEvent_ForSameUser_DoesNotInflateActivatedCount()
    {
        var harness = CreateHarness();

        await harness.Auth.Register(new RegisterDto(
            "pupil@example.com", Password, null, null, null, null, Ref: "stasya"));
        var user = await harness.UserManager.FindByEmailAsync("pupil@example.com");
        Assert.NotNull(user);

        var controller = SignedInAs(harness.Analytics, user!.Id);
        await controller.Track(new AnalyticsEventDto { Event = AnalyticsController.FirstChapterEvent, Meta = "Alice" });
        await controller.Track(new AnalyticsEventDto { Event = AnalyticsController.FirstChapterEvent, Meta = "Sherlock" });

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await harness.Analytics.Acquisition(AdminKey)).Value!;

        Assert.Equal(1, report.Totals.Registrations);
        Assert.Equal(1, report.Totals.Activated);
        Assert.Equal(
            1,
            await harness.Context.AnalyticsEvents.CountAsync(ae => ae.Event == AnalyticsController.FirstChapterEvent));
    }

    [Fact]
    public async Task UtmOnlyRegistration_LandsUnderItsChannelWithContentCode()
    {
        var harness = CreateHarness();

        // Пост в Дзене: личной ссылки нет, есть utm_source и utm_content поста
        await harness.Auth.Register(new RegisterDto(
            "zen@example.com",
            Password,
            null, null, null, null,
            UtmSource: "dzen",
            UtmMedium: "video",
            UtmContent: "roll-3"));

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await harness.Analytics.Acquisition(AdminKey)).Value!;

        var row = report.Rows.Single();
        Assert.Equal("dzen", row.Source);
        Assert.Equal("roll-3", row.Code);
        Assert.Equal(0, row.Activated);
    }

    [Fact]
    public async Task RegistrationFromPlainLink_IsCountedButStaysUnattributed()
    {
        var harness = CreateHarness();

        await harness.Auth.Register(new RegisterDto(
            "direct@example.com", Password, null, null, null, null));

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await harness.Analytics.Acquisition(AdminKey)).Value!;

        var row = report.Rows.Single();
        Assert.Null(row.Source);
        Assert.Equal(1, report.Totals.Registrations);
        Assert.Equal(0, report.Totals.Activated);
    }
}

/// <summary>
/// Контур между фронтендом и контроллером: тело регистрации собирается в
/// `registrationPayload` (frontend/src/lib/attribution.ts) и приходит в API
/// camelCase'ом. MVC связывает JSON по именам без учёта регистра, поэтому
/// «utmSource» и «utm_content» — это разные вещи: опечатка в ключ молча
/// проигнорирует, и атрибуция перестанет долетать до БД без единой ошибки.
/// </summary>
public class AcquisitionWireFormatTests
{
    /// <summary>Те же настройки, что у MVC-связывателя: camelCase вход, регистр не важен.</summary>
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    [Fact]
    public void RegisterDto_BindsThePayloadTheFrontendActuallySends()
    {
        var json = """
            {"email":"pupil@example.com","password":"Password1",
             "ref":"stasya","utmSource":"vk","utmMedium":"social","utmContent":"post-7"}
            """;

        var dto = JsonSerializer.Deserialize<RegisterDto>(json, WebJson);

        Assert.NotNull(dto);
        Assert.Equal("stasya", dto!.Ref);
        Assert.Equal("vk", dto.UtmSource);
        Assert.Equal("social", dto.UtmMedium);
        Assert.Equal("post-7", dto.UtmContent);
    }

    [Fact]
    public void RegisterDto_WithoutMarkers_LeavesEverythingNull()
    {
        var json = """
            {"email":"pupil@example.com","password":"Password1"}
            """;

        var dto = JsonSerializer.Deserialize<RegisterDto>(json, WebJson);

        Assert.NotNull(dto);
        Assert.Null(dto!.Ref);
        Assert.Null(dto.UtmSource);
        Assert.Null(dto.UtmMedium);
        Assert.Null(dto.UtmContent);
    }
}
