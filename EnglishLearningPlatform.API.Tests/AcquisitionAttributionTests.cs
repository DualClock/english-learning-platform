using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// W2.1.1 — атрибуция канала. Регистрация должна нести, откуда пришёл человек:
/// `?ref=<код>` (личная ссылка учителя или канала) важнее `utm_source`, потому что
/// ссылка обещана учителям в outreach-ките и по ней они ждут своих учеников.
///
/// Два правила, которые тут проверяются:
/// 1) значение нормализуется (только [a-z0-9-], нижний регистр, не больше 64 символов) —
///    иначе в колонку можно залить что угодно прямо из URL;
/// 2) пишется один раз при создании аккаунта и больше не перезаписывается —
///    иначе повторный вход с другой ссылкой переписывает историю.
/// </summary>
public class AcquisitionNormalizerTests
{
    [Theory]
    [InlineData("VK-Group", "vk-group")]
    [InlineData("  Stasya  ", "stasya")]
    [InlineData("books_tg_2026", "books-tg-2026")]      // подчёркивание — не код канала
    [InlineData("Telegram!!!", "telegram")]
    [InlineData("Zen/Post 42", "zen-post-42")]
    [InlineData("--a--b--", "a-b")]                     // обрамляющие и двойные дефисы
    [InlineData("dzen?utm_source=x", "dzen-utm-source-x")]
    public void Normalize_KeepsOnlySafeAlphabetAndLowercase(string raw, string expected)
    {
        Assert.Equal(expected, AcquisitionNormalizer.Normalize(raw));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("привет")]        // кириллица в код не попадает: канал латиницей
    [InlineData("😊")]
    [InlineData("---")]
    public void Normalize_RejectsEverythingWithoutLatinAlphabet(string? raw)
    {
        Assert.Null(AcquisitionNormalizer.Normalize(raw));
    }

    [Fact]
    public void Normalize_TruncatesToColumnLimit()
    {
        var normalized = AcquisitionNormalizer.Normalize(new string('a', 500));

        Assert.NotNull(normalized);
        Assert.Equal(AcquisitionNormalizer.MaxLength, normalized!.Length);
    }

    [Fact]
    public void Normalize_TruncationDoesNotLeaveTrailingDash()
    {
        // 60 букв + разделитель: после обрезки до 64 хвостовой дефис не должен остаться
        var normalized = AcquisitionNormalizer.Normalize(new string('a', 60) + "-" + new string('b', 20));

        Assert.NotNull(normalized);
        Assert.Equal(AcquisitionNormalizer.MaxLength, normalized!.Length);
        Assert.DoesNotContain("-", normalized[^1].ToString());
    }

    [Fact]
    public void Resolve_PersonalRefWinsOverUtmSource()
    {
        var (source, code) = AcquisitionNormalizer.Resolve(
            refCode: "Stasya",
            utmSource: "vk",
            utmMedium: null,
            utmContent: "post-1");

        Assert.Equal("stasya", source);
        Assert.Equal("stasya", code);
    }

    [Fact]
    public void Resolve_FallsBackToUtmSourceAndUsesUtmContentAsCode()
    {
        var (source, code) = AcquisitionNormalizer.Resolve(
            refCode: null,
            utmSource: "dzen",
            utmMedium: "social",
            utmContent: "video-3");

        Assert.Equal("dzen", source);
        Assert.Equal("video-3", code);
    }

    [Fact]
    public void Resolve_UtmMediumIsUsedWhenUtmSourceMissing()
    {
        var (source, code) = AcquisitionNormalizer.Resolve(
            refCode: null,
            utmSource: null,
            utmMedium: "product-radar",
            utmContent: null);

        Assert.Equal("product-radar", source);
        Assert.Null(code);
    }

    [Fact]
    public void Resolve_GarbageRefFallsBackToUtmSource()
    {
        // Код только看上去 латиницей: после нормализации он пустой — берём utm_source
        var (source, code) = AcquisitionNormalizer.Resolve(
            refCode: "??",
            utmSource: "telegram",
            utmMedium: null,
            utmContent: null);

        Assert.Equal("telegram", source);
        Assert.Null(code);
    }

    [Fact]
    public void Resolve_WithoutAnyMarkers_KeepsUserUnattributed()
    {
        var (source, code) = AcquisitionNormalizer.Resolve(null, null, null, null);

        Assert.Null(source);
        Assert.Null(code);
    }
}

/// <summary>
/// Источник пишется один раз. Отдельно проверяется, что Helper не трогает
/// уже заполненное поле — на этом держится обещание «кого привёл, тот и записан».
/// </summary>
public class AcquisitionWriteOnceTests
{
    [Fact]
    public void ApplyOnCreate_WritesNormalizedValues()
    {
        var user = new User();

        AcquisitionNormalizer.ApplyOnCreate(user, refCode: "Stasya", utmSource: "vk",
            utmMedium: null, utmContent: null);

        Assert.Equal("stasya", user.AcquisitionSource);
        Assert.Equal("stasya", user.AcquisitionCode);
    }

    [Fact]
    public void ApplyOnCreate_DoesNotOverwriteExistingValues()
    {
        var user = new User
        {
            AcquisitionSource = "dzen",
            AcquisitionCode = "video-1"
        };

        AcquisitionNormalizer.ApplyOnCreate(user, refCode: "hacker", utmSource: "telegram",
            utmMedium: null, utmContent: null);

        Assert.Equal("dzen", user.AcquisitionSource);
        Assert.Equal("video-1", user.AcquisitionCode);
    }

    [Fact]
    public void ApplyOnCreate_FillsOnlyTheMissingSide()
    {
        // Источник записан ещё в прошлой версии приложения, код — нет:
        // дописать код можно, переписать источник — нельзя.
        var user = new User { AcquisitionSource = "vk" };

        AcquisitionNormalizer.ApplyOnCreate(user, refCode: null, utmSource: "dzen",
            utmMedium: null, utmContent: "post-9");

        Assert.Equal("vk", user.AcquisitionSource);
        Assert.Equal("post-9", user.AcquisitionCode);
    }
}

/// <summary>
/// Сквозная проверка контроллера: тело регистрации долетает до колонки User,
/// а повторный вход и повторная попытка регистрации ничего не переписывают.
/// </summary>
public class AcquisitionRegistrationTests
{
    private const string Password = "Password1";

    private sealed record Harness(AuthController Controller, UserManager<User> UserManager, ApplicationDbContext Context);

    private static Harness CreateHarness()
    {
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
            .AddRoles<IdentityRole>()
            .AddEntityFrameworkStores<ApplicationDbContext>();

        var provider = services.BuildServiceProvider();
        var userManager = provider.GetRequiredService<UserManager<User>>();
        var db = provider.GetRequiredService<ApplicationDbContext>();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-secret-key-for-acquisition-tests-32",
                ["Jwt:Issuer"] = "TestIssuer",
                ["Jwt:Audience"] = "TestAudience",
                ["Jwt:ExpiryMinutes"] = "60"
            })
            .Build();

        var emailSender = new EmailSender(db, configuration, NullLogger<EmailSender>.Instance);
        var authEmail = new AuthEmailService(emailSender, configuration);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var controller = new AuthController(
            userManager,
            configuration,
            authEmail,
            NullLogger<AuthController>.Instance,
            cache,
            new RegistrationQuotaService(db, cache, configuration, NullLogger<RegistrationQuotaService>.Instance));

        return new Harness(controller, userManager, db);
    }

    [Fact]
    public async Task Register_WithRef_StoresChannelAndCode()
    {
        var harness = CreateHarness();

        var result = await harness.Controller.Register(new RegisterDto(
            "pupil@example.com",
            Password,
            DisplayName: null,
            CefrLevel: null,
            StudyGoal: null,
            DailyGoalMinutes: null,
            Ref: "Stasya"));

        Assert.IsType<OkObjectResult>(result);
        var user = await harness.UserManager.FindByEmailAsync("pupil@example.com");
        Assert.NotNull(user);
        Assert.Equal("stasya", user!.AcquisitionSource);
        Assert.Equal("stasya", user.AcquisitionCode);
    }

    [Fact]
    public async Task Register_WithoutAnyMarkers_LeavesAcquisitionEmpty()
    {
        var harness = CreateHarness();

        await harness.Controller.Register(new RegisterDto(
            "organic@example.com", Password, null, null, null, null));

        var user = await harness.UserManager.FindByEmailAsync("organic@example.com");
        Assert.NotNull(user);
        Assert.Null(user!.AcquisitionSource);
        Assert.Null(user.AcquisitionCode);
    }

    [Fact]
    public async Task Register_OverlongRef_IsCutToColumnLimit_NotRejected()
    {
        var harness = CreateHarness();

        await harness.Controller.Register(new RegisterDto(
            "long@example.com",
            Password,
            null, null, null, null,
            Ref: new string('x', 500)));

        var user = await harness.UserManager.FindByEmailAsync("long@example.com");
        Assert.NotNull(user);
        Assert.Equal(AcquisitionNormalizer.MaxLength, user!.AcquisitionSource!.Length);
        Assert.Equal(AcquisitionNormalizer.MaxLength, user.AcquisitionCode!.Length);
    }

    [Fact]
    public async Task RepeatRegistration_SameEmail_DoesNotOverwriteAcquisition()
    {
        var harness = CreateHarness();

        await harness.Controller.Register(new RegisterDto(
            "pupil@example.com", Password, null, null, null, null, Ref: "stasya"));

        // Повторный заход с чужой ссылкой: регистрация отклоняется, атрибуция остаётся.
        var second = await harness.Controller.Register(new RegisterDto(
            "pupil@example.com", Password, null, null, null, null, Ref: "someone-else"));

        Assert.IsNotType<OkObjectResult>(second);
        var user = await harness.UserManager.FindByEmailAsync("pupil@example.com");
        Assert.NotNull(user);
        Assert.Equal("stasya", user!.AcquisitionSource);
        Assert.Equal("stasya", user.AcquisitionCode);
    }

    [Fact]
    public async Task Login_DoesNotOverwriteAcquisition()
    {
        var harness = CreateHarness();

        await harness.Controller.Register(new RegisterDto(
            "pupil@example.com", Password, null, null, null, null, Ref: "stasya"));

        // Человек вернулся по ссылке другого канала — вход не должен переписать канал.
        var login = await harness.Controller.Login(new LoginDto("pupil@example.com", Password));

        Assert.IsType<OkObjectResult>(login);
        var user = await harness.UserManager.FindByEmailAsync("pupil@example.com");
        Assert.NotNull(user);
        Assert.Equal("stasya", user!.AcquisitionSource);
        Assert.Equal("stasya", user.AcquisitionCode);
    }
}
