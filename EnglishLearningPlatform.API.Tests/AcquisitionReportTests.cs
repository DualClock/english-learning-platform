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

    // ---- W2.4: гостевой верх воронки в том же ответе ------------------------

    private static void GuestEvent(
        ApplicationDbContext context,
        string eventName,
        DateOnly day,
        string ipHash,
        string? level = null)
    {
        context.GuestAnalyticsEvents.Add(new GuestAnalyticsEvent
        {
            Event = eventName,
            Day = day,
            Hour = 12,
            IpHash = ipHash,
            Level = level,
            // отдельный nonce на каждую строку теста: иначе антидубль склеил бы их
            DedupeKey = $"{eventName}-{ipHash}-{day:yyyyMMdd}-{level}"
        });
    }

    [Fact]
    public async Task Acquisition_FunnelCarriesGuestStartsAndCompletionsPerDay()
    {
        using var context = CreateContext();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var yesterday = today.AddDays(-1);

        GuestEvent(context, AnonymousAnalyticsController.StartedEvent, yesterday, "ip-1");
        GuestEvent(context, AnonymousAnalyticsController.StartedEvent, yesterday, "ip-2");
        GuestEvent(context, AnonymousAnalyticsController.CompletedEvent, yesterday, "ip-1", "b1");
        GuestEvent(context, AnonymousAnalyticsController.StartedEvent, today, "ip-3");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        var day = report.Funnel.Single(f => f.Date == yesterday.ToString("yyyy-MM-dd"));
        Assert.Equal(2, day.GuestStarts);
        Assert.Equal(1, day.GuestCompletions);
        Assert.Equal(2, day.GuestVisitors);
        // Регистраций в этот день не было — воронка всё равно обязана показать день:
        // «тест качают, но не регистрируются» и есть предмет разговора с менеджером.
        Assert.Equal(0, day.Registrations);

        Assert.Equal(3, report.Guest.Starts);
        Assert.Equal(1, report.Guest.Completions);
        Assert.Equal(3, report.Guest.Visitors);
    }

    [Fact]
    public async Task Acquisition_FunnelRegistrationsMatchChannelRows()
    {
        using var context = CreateContext();
        var twoDaysAgo = DateTime.UtcNow.AddDays(-2);
        var day = DateOnly.FromDateTime(twoDaysAgo);

        context.Users.AddRange(
            MakeUser("vk-1", "vk", "post-1", twoDaysAgo),
            MakeUser("vk-2", "vk", "post-2", twoDaysAgo));
        Activate(context, "vk-1");
        GuestEvent(context, AnonymousAnalyticsController.StartedEvent, day, "ip-9");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        var funnel = report.Funnel.Single();
        Assert.Equal(report.Rows.Sum(r => r.Registrations), funnel.Registrations);
        Assert.Equal(report.Rows.Sum(r => r.Activated), funnel.Activated);
        Assert.Equal(1, funnel.GuestStarts);
    }

    [Fact]
    public async Task Acquisition_FunnelBreaksCompletionsDownByLevel()
    {
        using var context = CreateContext();
        var day = DateOnly.FromDateTime(DateTime.UtcNow);

        GuestEvent(context, AnonymousAnalyticsController.CompletedEvent, day, "ip-1", "a2");
        GuestEvent(context, AnonymousAnalyticsController.CompletedEvent, day, "ip-2", "b1");
        GuestEvent(context, AnonymousAnalyticsController.CompletedEvent, day, "ip-3", "b1");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        Assert.Equal(
            new[] { ("a2", 1), ("b1", 2) },
            report.ByLevel.Select(l => (l.Level, l.Completions)));
    }

    [Fact]
    public async Task Acquisition_GuestVisitorsCountHashesNotRawIps()
    {
        using var context = CreateContext();
        var day = DateOnly.FromDateTime(DateTime.UtcNow);

        // Две отправки одного гостя (тот же хеш) = один посетитель; при этом
        // стартов и завершений в воронке ровно столько, сколько событий.
        GuestEvent(context, AnonymousAnalyticsController.StartedEvent, day, "ip-same");
        GuestEvent(context, AnonymousAnalyticsController.CompletedEvent, day, "ip-same", "c1");
        GuestEvent(context, AnonymousAnalyticsController.StartedEvent, day, "ip-other");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        Assert.Equal(2, report.Guest.Visitors);
        Assert.Equal(2, report.Guest.Starts);
        Assert.Equal(1, report.Guest.Completions);
    }

    [Fact]
    public async Task Acquisition_IgnoresGuestEventsFromBeforeTheWindow()
    {
        using var context = CreateContext();

        GuestEvent(context, AnonymousAnalyticsController.StartedEvent,
            DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-40)), "ip-old");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret", 14)).Value!;

        Assert.Empty(report.Funnel);
        Assert.Equal(0, report.Guest.Starts);
    }

    [Fact]
    public async Task Acquisition_EmptyEverything_IsStillAValidFlatReport()
    {
        // Окно без событий: менеджер должен получить нули, а не падение —
        // выгрузка читается скриптом, а не глазами.
        using var context = CreateContext();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        Assert.Empty(report.Funnel);
        Assert.Empty(report.ByLevel);
        Assert.Equal(0, report.Guest.Starts);
        Assert.Equal(0, report.Guest.CohortViews);
        Assert.Equal(0, report.Guest.LibraryViews);
        Assert.Equal(0, report.Totals.Registrations);
    }

    // ---- W3.4: просмотры витрин как ступень ДО теста -------------------------

    [Fact]
    public async Task Acquisition_FunnelCarriesPageViewsPerDay()
    {
        using var context = CreateContext();
        var yesterday = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        GuestEvent(context, AnonymousAnalyticsController.CohortViewedEvent, yesterday, "ip-1");
        GuestEvent(context, AnonymousAnalyticsController.CohortViewedEvent, yesterday, "ip-2");
        GuestEvent(context, AnonymousAnalyticsController.LibraryViewedEvent, yesterday, "ip-1");
        GuestEvent(context, AnonymousAnalyticsController.CohortViewedEvent, today, "ip-3");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        var day = report.Funnel.Single(f => f.Date == yesterday.ToString("yyyy-MM-dd"));
        Assert.Equal(2, day.CohortViews);
        Assert.Equal(1, day.LibraryViews);

        // Ни старта теста, ни регистраций в этот день не было — просмотры всё
        // равно обязаны остаться в ответе: ровно ради этого дня воронку и
        // расширяли («человек увидел когорту, но до теста не дошёл»).
        Assert.Equal(0, day.GuestStarts);
        Assert.Equal(0, day.GuestCompletions);
        Assert.Equal(0, day.Registrations);

        Assert.Equal(3, report.Guest.CohortViews);
        Assert.Equal(1, report.Guest.LibraryViews);
    }

    [Fact]
    public async Task Acquisition_FunnelViewCountersConvergeWithRawRows()
    {
        using var context = CreateContext();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var twoDaysAgo = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-2));

        // Смешанный день: просмотры + тестовые события, чтобы проверить, что
        // новые колонки не подменяют и не обнуляют старые.
        GuestEvent(context, AnonymousAnalyticsController.CohortViewedEvent, today, "ip-a");
        GuestEvent(context, AnonymousAnalyticsController.CohortViewedEvent, today, "ip-b");
        GuestEvent(context, AnonymousAnalyticsController.LibraryViewedEvent, today, "ip-a");
        GuestEvent(context, AnonymousAnalyticsController.StartedEvent, today, "ip-a");
        GuestEvent(context, AnonymousAnalyticsController.CompletedEvent, today, "ip-a", "b1");
        GuestEvent(context, AnonymousAnalyticsController.LibraryViewedEvent, twoDaysAgo, "ip-c");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        var rows = await context.GuestAnalyticsEvents.ToListAsync();

        // Сходство с сырыми записями — то, что счётчик считает именно таблицу,
        // а не своё собственное представление о ней.
        foreach (var funnelDay in report.Funnel)
        {
            var day = DateOnly.Parse(funnelDay.Date);
            var rawOfDay = rows.Where(g => g.Day == day).ToArray();

            Assert.Equal(
                rawOfDay.Count(g => g.Event == AnonymousAnalyticsController.CohortViewedEvent),
                funnelDay.CohortViews);
            Assert.Equal(
                rawOfDay.Count(g => g.Event == AnonymousAnalyticsController.LibraryViewedEvent),
                funnelDay.LibraryViews);
            Assert.Equal(
                rawOfDay.Count(g => g.Event == AnonymousAnalyticsController.StartedEvent),
                funnelDay.GuestStarts);
            Assert.Equal(
                rawOfDay.Count(g => g.Event == AnonymousAnalyticsController.CompletedEvent),
                funnelDay.GuestCompletions);
        }

        Assert.Equal(
            rows.Count(g => g.Event == AnonymousAnalyticsController.CohortViewedEvent),
            report.Funnel.Sum(f => f.CohortViews));
        Assert.Equal(report.Guest.CohortViews, report.Funnel.Sum(f => f.CohortViews));
        Assert.Equal(report.Guest.LibraryViews, report.Funnel.Sum(f => f.LibraryViews));

        // Порядок дней — по возрастанию, как и раньше.
        Assert.Equal(
            report.Funnel.Select(f => f.Date).OrderBy(d => d, StringComparer.Ordinal),
            report.Funnel.Select(f => f.Date));

        // Просмотры не превратились в «тест начали»: у дня две отдельные пары чисел.
        var todayRow = report.Funnel.Single(f => f.Date == today.ToString("yyyy-MM-dd"));
        Assert.Equal(2, todayRow.CohortViews);
        Assert.Equal(1, todayRow.GuestStarts);
        Assert.Equal(1, todayRow.GuestCompletions);
    }

    [Fact]
    public async Task Acquisition_PageViewOnlyWindow_KeepsRegistrationsAndLevelsUntouched()
    {
        using var context = CreateContext();
        var day = DateOnly.FromDateTime(DateTime.UtcNow);

        context.Users.Add(MakeUser("u-1", "vk", "post-1", DateTime.UtcNow));
        GuestEvent(context, AnonymousAnalyticsController.CohortViewedEvent, day, "ip-1");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret")).Value!;

        var funnel = report.Funnel.Single();
        Assert.Equal(1, funnel.CohortViews);
        Assert.Equal(0, funnel.LibraryViews);

        // Существующие поля живут своей жизнью: расширение воронки не тронуло
        // ни регистрации, ни активации, ни разбивку по уровням.
        Assert.Equal(1, funnel.Registrations);
        Assert.Equal(0, funnel.Activated);
        Assert.Empty(report.ByLevel);
        Assert.Equal(0, report.Guest.Starts);
    }

    [Fact]
    public async Task Acquisition_IgnoresPageViewsFromBeforeTheWindow()
    {
        using var context = CreateContext();

        GuestEvent(context, AnonymousAnalyticsController.CohortViewedEvent,
            DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-40)), "ip-old");
        await context.SaveChangesAsync();

        var report = (AnalyticsController.AcquisitionReport)
            ((OkObjectResult)await CreateReportController(context).Acquisition("admin-secret", 14)).Value!;

        Assert.Empty(report.Funnel);
        Assert.Equal(0, report.Guest.CohortViews);
    }
}
