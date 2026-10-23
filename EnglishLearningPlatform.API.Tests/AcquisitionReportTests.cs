using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Tests.Security;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// W2.1.4 — выгрузка для менеджера: `GET /api/analytics/acquisition?days=14`.
///
/// Ответ на вопрос «какой канал привёл не просто регистрации, а людей, которые
/// читают». Строка — это день × канал: сколько зарегистрировалось и сколько из
/// них открыли первую главу. Срез когортный: активация считается по тем, кто
/// зарегистрировался в этом дне, а не по всем событиям дня.
///
/// Выдача — бизнес-метрики всего проекта и коды каналов, поэтому доступ только
/// по административному ключу (тот же Seeder:Key, что и у /summary).
/// </summary>
public class AcquisitionReportTests
{
    private static ApplicationDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static AnalyticsController CreateController(
        ApplicationDbContext context,
        Dictionary<string, string?> settings,
        string environmentName = "Production")
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(settings)
            .Build();

        return new AnalyticsController(
            context,
            NullLogger<AnalyticsController>.Instance,
            configuration,
            new TestWebHostEnvironment { EnvironmentName = environmentName });
    }

    private static AnalyticsController CreateReportController(ApplicationDbContext context) =>
        CreateController(context, new Dictionary<string, string?> { ["Seeder:Key"] = "admin-secret" });

    private static User MakeUser(string id, string? source, string? code, DateTime createdAt) => new()
    {
        Id = id,
        UserName = $"{id}@example.com",
        Email = $"{id}@example.com",
        AcquisitionSource = source,
        AcquisitionCode = code,
        CreatedAt = createdAt
    };

    private static void Activate(ApplicationDbContext context, string userId, DateTime? at = null)
    {
        context.AnalyticsEvents.Add(new AnalyticsEvent
        {
            UserId = userId,
            Event = AnalyticsController.FirstChapterEvent,
            CreatedAt = at ?? DateTime.UtcNow
        });
    }

    [Fact]
    public async Task Acquisition_WithoutAdminKey_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context, new Dictionary<string, string?> { ["Seeder:Key"] = "admin-secret" });

        var result = await controller.Acquisition(null);

        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task Acquisition_WithWrongAdminKey_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context, new Dictionary<string, string?> { ["Seeder:Key"] = "admin-secret" });

        var result = await controller.Acquisition("wrong-key");

        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task Acquisition_KeyNotConfiguredInProduction_IsForbidden()
    {
        using var context = CreateContext();
        var controller = CreateController(context, new Dictionary<string, string?>());

        var result = await controller.Acquisition("anything");

        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task Acquisition_WithAdminKey_ReturnsReport()
    {
        using var context = CreateContext();
        context.Users.Add(MakeUser("u1", "stasya", "stasya", DateTime.UtcNow.AddDays(-2)));
        await context.SaveChangesAsync();

        var result = await CreateReportController(context).Acquisition("admin-secret");

        Assert.IsType<OkObjectResult>(result);
        var report = Assert.IsType<AnalyticsController.AcquisitionReport>(
            ((OkObjectResult)result).Value);
        Assert.Equal(1, report.Totals.Registrations);
    }

    [Fact]
    public async Task Acquisition_GroupsRegistrationsAndActivationsByDayAndSource()
    {
        using var context = CreateContext();
        var twoDaysAgo = DateTime.UtcNow.AddDays(-2);
        var yesterday = DateTime.UtcNow.AddDays(-1);

        context.Users.AddRange(
            MakeUser("vk-1", "vk", "post-7", twoDaysAgo),
            MakeUser("vk-2", "vk", "post-7", twoDaysAgo),
            MakeUser("vk-3", "vk", "post-9", twoDaysAgo),
            MakeUser("dzen-1", "dzen", null, yesterday));
        Activate(context, "vk-1");
        Activate(context, "vk-3");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        var post7 = report.Rows.Single(r => r.Date == twoDaysAgo.ToString("yyyy-MM-dd") && r.Code == "post-7");
        Assert.Equal("vk", post7.Source);
        Assert.Equal(2, post7.Registrations);
        Assert.Equal(1, post7.Activated);

        var post9 = report.Rows.Single(r => r.Code == "post-9");
        Assert.Equal(1, post9.Registrations);
        Assert.Equal(1, post9.Activated);

        Assert.Equal(4, report.Totals.Registrations);
        Assert.Equal(2, report.Totals.Activated);
    }

    [Fact]
    public async Task Acquisition_SumsUpChannelsAcrossTheWindow()
    {
        using var context = CreateContext();

        context.Users.AddRange(
            MakeUser("s-1", "stasya", "stasya", DateTime.UtcNow.AddDays(-5)),
            MakeUser("s-2", "stasya", "stasya", DateTime.UtcNow.AddDays(-1)));
        Activate(context, "s-2");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        var stasya = report.ByChannel.Single(c => c.Source == "stasya");
        Assert.Equal(2, stasya.Registrations);
        Assert.Equal(1, stasya.Activated);
        // Итог по каналам отсортирован по убыванию регистраций: первым то, что работает
        Assert.Equal("stasya", report.ByChannel.First().Source);
    }

    [Fact]
    public async Task Acquisition_KeepsUnattributedRegistrationsVisible()
    {
        // «Прямые» заходы без меток — тоже канал: их доля показывает, работает ли
        // рассылка вообще, или люди приходят сами.
        using var context = CreateContext();

        context.Users.Add(MakeUser("direct-1", null, null, DateTime.UtcNow.AddDays(-1)));
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        var row = report.Rows.Single();
        Assert.Null(row.Source);
        Assert.Equal(1, row.Registrations);
        Assert.Equal(0, row.Activated);
    }

    [Fact]
    public async Task Acquisition_IgnoresActivationsOfUsersFromOutsideTheWindow()
    {
        using var context = CreateContext();
        var longAgo = DateTime.UtcNow.AddDays(-60);

        context.Users.Add(MakeUser("old-visitor", "stasya", "stasya", longAgo));
        Activate(context, "old-visitor");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret", 14)).Value!;

        Assert.Empty(report.Rows);
        Assert.Equal(0, report.Totals.Registrations);
    }

    [Fact]
    public async Task Acquisition_CountsUserOnceEvenIfEventWasWrittenTwice()
    {
        // Исторические дубли не должны превращать одного человека в двух читающих.
        using var context = CreateContext();

        context.Users.Add(MakeUser("dupe", "vk", "post-1", DateTime.UtcNow.AddDays(-1)));
        Activate(context, "dupe");
        Activate(context, "dupe");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        Assert.Equal(1, report.Rows.Single().Activated);
    }

    [Fact]
    public async Task Acquisition_WindowIsClampedToSaneBounds()
    {
        using var context = CreateContext();
        var fiveDaysAgo = DateTime.UtcNow.AddDays(-5);
        context.Users.Add(MakeUser("u", "vk", null, fiveDaysAgo));
        await context.SaveChangesAsync();

        var zeroDays = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret", 0)).Value!;
        Assert.Equal(1, zeroDays.Days);
        Assert.Empty(zeroDays.Rows);

        var hugeWindow = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret", 100000)).Value!;
        Assert.Equal(90, hugeWindow.Days);
        Assert.Single(hugeWindow.Rows);
    }
}
