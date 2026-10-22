using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// GET /api/analytics/summary — сводка по всему проекту «для владельца».
/// Любой зарегистрированный пользователь не должен видеть бизнес-метрики:
/// доступ закрыт административным ключом (X-Seed-Key).
/// </summary>
public class AnalyticsAccessTests
{
    private static AnalyticsController CreateController(
        Dictionary<string, string?> settings,
        string environmentName = "Production")
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(settings)
            .Build();

        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        context.AnalyticsEvents.Add(new AnalyticsEvent
        {
            UserId = "user-1",
            Event = "login"
        });
        context.SaveChanges();

        var environment = new TestWebHostEnvironment { EnvironmentName = environmentName };

        return new AnalyticsController(
            context,
            NullLogger<AnalyticsController>.Instance,
            configuration,
            environment);
    }

    [Fact]
    public async Task Summary_WithoutAdminKey_IsRejected()
    {
        var controller = CreateController(new Dictionary<string, string?>
        {
            ["Seeder:Key"] = "admin-secret"
        });

        var result = await controller.Summary(null);

        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task Summary_WithWrongAdminKey_IsRejected()
    {
        var controller = CreateController(new Dictionary<string, string?>
        {
            ["Seeder:Key"] = "admin-secret"
        });

        var result = await controller.Summary("wrong-key");

        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task Summary_WithAdminKey_ReturnsSummary()
    {
        var controller = CreateController(new Dictionary<string, string?>
        {
            ["Seeder:Key"] = "admin-secret"
        });

        var result = await controller.Summary("admin-secret");

        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public async Task Summary_KeyNotConfiguredInProduction_IsForbidden()
    {
        var controller = CreateController(new Dictionary<string, string?>());

        var result = await controller.Summary("anything");

        Assert.IsType<ForbidResult>(result);
    }
}
