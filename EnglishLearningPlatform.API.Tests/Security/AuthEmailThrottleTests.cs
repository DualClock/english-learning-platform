using System.Security.Claims;
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
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// Письма сброса пароля и подтверждения email можно запрашивать без ограничений
/// (кроме 10 запросов/мин на IP). Один и тот же адрес должен получать письмо
/// не чаще раза в несколько минут — иначе это инструмент email-бомбинга.
/// </summary>
public class AuthEmailThrottleTests
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
        })
        .AddEntityFrameworkStores<ApplicationDbContext>()
        .AddDefaultTokenProviders();

        var provider = services.BuildServiceProvider();
        var userManager = provider.GetRequiredService<UserManager<User>>();
        var context = provider.GetRequiredService<ApplicationDbContext>();
        var cache = new MemoryCache(new MemoryCacheOptions());

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-secret-key-for-email-tests-32ch!",
                ["Jwt:Issuer"] = "TestIssuer",
                ["Jwt:Audience"] = "TestAudience",
                ["Jwt:ExpiryMinutes"] = "60"
            })
            .Build();

        var emailSender = new EmailSender(context, configuration, NullLogger<EmailSender>.Instance);
        var authEmail = new AuthEmailService(emailSender, configuration);

        var controller = new AuthController(
            userManager,
            configuration,
            authEmail,
            NullLogger<AuthController>.Instance,
            cache);

        return new Harness(controller, userManager, context);
    }

    [Fact]
    public async Task ForgotPassword_RepeatedRequest_DoesNotSendSecondEmail()
    {
        var harness = CreateHarness();
        var user = new User
        {
            UserName = "victim@example.com",
            Email = "victim@example.com",
            LockoutEnabled = true
        };
        Assert.True((await harness.UserManager.CreateAsync(user, "Password1")).Succeeded);

        var first = await harness.Controller.ForgotPassword(new ForgotPasswordDto("victim@example.com"));
        var second = await harness.Controller.ForgotPassword(new ForgotPasswordDto("victim@example.com"));

        Assert.IsType<OkObjectResult>(first);
        Assert.IsType<OkObjectResult>(second);
        Assert.Equal(1, await harness.Context.EmailMessages.CountAsync(m => m.Kind == "password-reset"));
    }

    [Fact]
    public async Task ResendConfirmation_RepeatedRequest_DoesNotSendSecondEmail()
    {
        var harness = CreateHarness();
        var user = new User
        {
            UserName = "confirm@example.com",
            Email = "confirm@example.com",
            EmailConfirmed = false,
            LockoutEnabled = true
        };
        Assert.True((await harness.UserManager.CreateAsync(user, "Password1")).Succeeded);

        harness.Controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    new[] { new Claim(ClaimTypes.NameIdentifier, user.Id) },
                    authenticationType: "Test"))
            }
        };

        var first = await harness.Controller.ResendConfirmation();
        var second = await harness.Controller.ResendConfirmation();

        Assert.IsType<OkObjectResult>(first);
        Assert.IsType<OkObjectResult>(second);
        Assert.Equal(1, await harness.Context.EmailMessages.CountAsync(m => m.Kind == "confirm-email"));
    }
}
