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

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// Брутфорс пароля: после пяти неудачных попыток аккаунт должен блокироваться
/// на время, даже если дальше приходит правильный пароль. CheckPasswordAsync
/// сам по себе не считает неудачи — это обязан делать контроллер входа.
/// </summary>
public class LoginLockoutTests
{
    private sealed record Harness(
        AuthController Controller,
        UserManager<User> UserManager,
        ApplicationDbContext Context);

    private static Harness CreateHarness()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDataProtection();
        services.AddDbContext<ApplicationDbContext>(options =>
            options.UseInMemoryDatabase(Guid.NewGuid().ToString()));
        services.AddIdentityCore<User>(options =>
        {
            options.Password.RequireDigit = true;
            options.Password.RequireLowercase = true;
            options.Password.RequireUppercase = true;
            options.Password.RequireNonAlphanumeric = false;
            options.Password.RequiredLength = 6;
            options.Lockout.AllowedForNewUsers = true;
            options.Lockout.MaxFailedAccessAttempts = 5;
            options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);
        })
        .AddEntityFrameworkStores<ApplicationDbContext>()
        .AddDefaultTokenProviders();

        var provider = services.BuildServiceProvider();
        var userManager = provider.GetRequiredService<UserManager<User>>();
        var context = provider.GetRequiredService<ApplicationDbContext>();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-secret-key-for-lockout-tests-32ch",
                ["Jwt:Issuer"] = "TestIssuer",
                ["Jwt:Audience"] = "TestAudience",
                ["Jwt:ExpiryMinutes"] = "60"
            })
            .Build();

        var emailSender = new EmailSender(context, configuration, NullLogger<EmailSender>.Instance);
        var authEmail = new AuthEmailService(emailSender, configuration);
        var cache = new MemoryCache(new MemoryCacheOptions());

        var controller = new AuthController(
            userManager,
            configuration,
            authEmail,
            NullLogger<AuthController>.Instance,
            cache,
            new RegistrationQuotaService(context, cache, configuration, NullLogger<RegistrationQuotaService>.Instance));

        return new Harness(controller, userManager, context);
    }

    private static User NewUser(string email) => new()
    {
        UserName = email,
        Email = email,
        EmailConfirmed = true,
        LockoutEnabled = true
    };

    [Fact]
    public async Task Login_FiveWrongPasswords_LocksAccountEvenForCorrectPassword()
    {
        var harness = CreateHarness();
        var user = NewUser("brute@example.com");
        var created = await harness.UserManager.CreateAsync(user, "Password1");
        Assert.True(created.Succeeded);

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var wrong = await harness.Controller.Login(new LoginDto("brute@example.com", "WrongPass1"));
            Assert.IsType<UnauthorizedObjectResult>(wrong);
        }

        Assert.True(await harness.UserManager.IsLockedOutAsync(user));

        var correct = await harness.Controller.Login(new LoginDto("brute@example.com", "Password1"));
        Assert.IsType<UnauthorizedObjectResult>(correct);
    }

    [Fact]
    public async Task Login_Success_ResetsFailedAttemptCounter()
    {
        var harness = CreateHarness();
        var user = NewUser("reset@example.com");
        var created = await harness.UserManager.CreateAsync(user, "Password1");
        Assert.True(created.Succeeded);

        for (var attempt = 0; attempt < 3; attempt++)
        {
            await harness.UserManager.AccessFailedAsync(user);
        }

        var result = await harness.Controller.Login(new LoginDto("reset@example.com", "Password1"));

        Assert.IsType<OkObjectResult>(result);
        var refreshed = await harness.UserManager.FindByEmailAsync("reset@example.com");
        Assert.Equal(0, refreshed!.AccessFailedCount);
    }

    [Fact]
    public async Task Register_EnablesLockoutForNewAccount()
    {
        var harness = CreateHarness();

        var result = await harness.Controller.Register(new RegisterDto(
            "newcomer@example.com",
            "Password1",
            DisplayName: "Newcomer",
            CefrLevel: null,
            StudyGoal: null,
            DailyGoalMinutes: null));

        Assert.IsType<OkObjectResult>(result);
        var user = await harness.UserManager.FindByEmailAsync("newcomer@example.com");
        Assert.NotNull(user);
        Assert.True(user!.LockoutEnabled);
    }
}
