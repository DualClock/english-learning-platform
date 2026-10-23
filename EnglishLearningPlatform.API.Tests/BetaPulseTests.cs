using System.Security.Claims;
using System.Text.Json;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Tests.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// W4.1 Feedback Pulse — три имени события, закрытая meta и правило частоты.
///
/// Цель беты — не регистрации, а 40 содержательных отзывов от 60 читающих.
/// Микроопрос из 2–3 вопросов даёт 15,97% ответов против 6,87% при семи и
/// больше, а in-app промпт 18,69% против 7,64% у виджета — то есть весь смысл
/// в том, чтобы спросить одного короткого вопроса в момент чтения. Три вещи
/// держат это измерение в порядке, и все три проверяются здесь:
///  - имена ровно те три, что умеет клиент (лишнее имя = метрика без автора);
///  - meta закрыта, потому что свободный текст в аналитике — это чужой отзыв
///    не в том месте и потенциальный PII в прод-таблице;
///  - частоту считает сервер: у человека три устройства, и без серверного
///    правила мы мерили бы раздражение вместо мнений.
/// </summary>
public class BetaPulseEventTests
{
    private static ApplicationDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static AnalyticsController CreateController(ApplicationDbContext context, string userId)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Seeder:Key"] = "admin-secret" })
            .Build();

        var controller = new AnalyticsController(
            context,
            NullLogger<AnalyticsController>.Instance,
            configuration,
            new TestWebHostEnvironment());

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

    // ---- имена ---------------------------------------------------------------

    [Fact]
    public void PulseEventNames_AreExactlyThreeAndNamedAsClientSendsThem()
    {
        // Имена — контракт между читалкой, выгрузкой и таблицей. Любая опечатка
        // в отчёте означает молчаливый ноль в колонке, поэтому сверяется строка.
        Assert.Equal("beta_pulse_seen", AnalyticsController.PulseSeenEvent);
        Assert.Equal("beta_pulse_answered", AnalyticsController.PulseAnsweredEvent);
        Assert.Equal("beta_pulse_dismissed", AnalyticsController.PulseDismissedEvent);

        Assert.Equal(
            new[] { "beta_pulse_answered", "beta_pulse_dismissed", "beta_pulse_seen" },
            AnalyticsController.PulseEvents.OrderBy(e => e, StringComparer.Ordinal).ToArray());

        foreach (var name in AnalyticsController.PulseEvents)
        {
            Assert.Contains(name, AnalyticsController.AllowedEvents);
        }
    }

    [Fact]
    public void PulseNames_DoNotCollideWithGuestWhitelist()
    {
        // Гостевой и читательский контуры — разные таблицы и разные права write.
        // Пересечение имён означало бы, что анонимный путь может писать метрики
        // читателя (и наоборот).
        Assert.Empty(AnonymousAnalyticsController.AllowedEvents.Intersect(AnalyticsController.AllowedEvents));
    }

    [Theory]
    [InlineData("beta_pulse_seen", "")]
    [InlineData("beta_pulse_answered", "word")]
    [InlineData("beta_pulse_dismissed", "dismiss")]
    public async Task ThreePulseEvents_AreAcceptedAndStored(string eventName, string meta)
    {
        using var context = CreateContext();
        var controller = CreateController(context, "reader-a");

        var result = await controller.Track(new AnalyticsEventDto { Event = eventName, Meta = meta });

        Assert.IsType<OkResult>(result);
        var stored = Assert.Single(await context.AnalyticsEvents.ToListAsync());
        Assert.Equal(eventName, stored.Event);
        Assert.Equal(meta, stored.Meta);
    }

    [Fact]
    public async Task PulseEventVariantWithUnknownName_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context, "reader-a");

        var result = await controller.Track(new AnalyticsEventDto
        {
            Event = "beta_pulse_answered_v2",
            Meta = "word"
        });

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(await context.AnalyticsEvents.ToListAsync());
    }

    // ---- закрытая meta -------------------------------------------------------

    [Fact]
    public async Task Answered_WithFreeText_IsRejectedAndNothingWritten()
    {
        // Это и есть главный запрет: «что бесит — перевод слова, но ещё и…».
        // Такой текст принадлежит форме отзыва, где он уходит письмом человеку,
        // а не строке в аналитике, где он лежит вечным чужим комментарием.
        using var context = CreateContext();
        var controller = CreateController(context, "reader-a");

        var result = await controller.Track(new AnalyticsEventDto
        {
            Event = AnalyticsController.PulseAnsweredEvent,
            Meta = "anything-else"
        });

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(await context.AnalyticsEvents.ToListAsync());
    }

    [Fact]
    public async Task Answered_WithoutOption_IsRejected()
    {
        // Ответ без варианта — это сломанная кнопка: числитель ответа пропал, а
        // знаменатель показов остался, и конверсия pulse стала ниже без причины.
        using var context = CreateContext();
        var controller = CreateController(context, "reader-a");

        var empty = await controller.Track(new AnalyticsEventDto
        {
            Event = AnalyticsController.PulseAnsweredEvent,
            Meta = ""
        });
        var missing = await controller.Track(new AnalyticsEventDto
        {
            Event = AnalyticsController.PulseAnsweredEvent,
            Meta = null
        });

        Assert.IsType<BadRequestObjectResult>(empty);
        Assert.IsType<BadRequestObjectResult>(missing);
        Assert.Empty(await context.AnalyticsEvents.ToListAsync());
    }

    [Theory]
    [InlineData("word")]
    [InlineData("repetition")]
    [InlineData("text")]
    [InlineData("other")]
    public async Task Answered_EveryClosedOption_IsAccepted(string option)
    {
        using var context = CreateContext();
        var controller = CreateController(context, "reader-a");

        var result = await controller.Track(new AnalyticsEventDto
        {
            Event = AnalyticsController.PulseAnsweredEvent,
            Meta = option
        });

        Assert.IsType<OkResult>(result);
        Assert.Equal(option, (await context.AnalyticsEvents.SingleAsync()).Meta);
    }

    [Fact]
    public async Task Answered_OptionIsStoredLowercased()
    {
        // "Word" и "word" в выгрузке стали бы двумя вариантами там, где был один.
        using var context = CreateContext();
        var controller = CreateController(context, "reader-a");

        await controller.Track(new AnalyticsEventDto
        {
            Event = AnalyticsController.PulseAnsweredEvent,
            Meta = "  WORD  "
        });

        Assert.Equal("word", (await context.AnalyticsEvents.SingleAsync()).Meta);
    }

    [Theory]
    [InlineData("beta_pulse_seen", "")]
    [InlineData("beta_pulse_seen", "dismiss")]
    [InlineData("beta_pulse_dismissed", "")]
    [InlineData("beta_pulse_dismissed", "dismiss")]
    public async Task Impressions_AcceptOnlyEmptyOrDismiss(string eventName, string meta)
    {
        using var context = CreateContext();
        var controller = CreateController(context, "reader-a");

        var result = await controller.Track(new AnalyticsEventDto { Event = eventName, Meta = meta });

        Assert.IsType<OkResult>(result);
    }

    [Theory]
    [InlineData("beta_pulse_seen")]
    [InlineData("beta_pulse_dismissed")]
    public async Task Impressions_WithFreeText_AreRejected(string eventName)
    {
        using var context = CreateContext();
        var controller = CreateController(context, "reader-a");

        var result = await controller.Track(new AnalyticsEventDto
        {
            Event = eventName,
            Meta = "книга сломалась на третьей странице"
        });

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(await context.AnalyticsEvents.ToListAsync());
    }

    [Fact]
    public async Task OrdinaryEvents_KeepTheirFreeMeta()
    {
        // Закрытие касается только pulse: `book_opened` и `chapter_opened_first`
        // пишут название книги, и это историческое поведение менять нельзя.
        using var context = CreateContext();
        var controller = CreateController(context, "reader-a");

        var result = await controller.Track(new AnalyticsEventDto
        {
            Event = "book_opened",
            Meta = "Alice in Wonderland"
        });

        Assert.IsType<OkResult>(result);
        Assert.Equal("Alice in Wonderland", (await context.AnalyticsEvents.SingleAsync()).Meta);
    }
}

/// <summary>
/// GET /api/analytics/pulse/eligible — частотное правило на сервере.
///
/// Порог «7 суток» и требование «начал читать» берутся из базы событий, поэтому
/// тесты работают с CreatedAt напрямую: ровно так же их увидит живой запрос.
/// </summary>
public class BetaPulseEligibilityTests
{
    private static ApplicationDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static AnalyticsController CreateController(ApplicationDbContext context, string userId)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Seeder:Key"] = "admin-secret" })
            .Build();

        var controller = new AnalyticsController(
            context,
            NullLogger<AnalyticsController>.Instance,
            configuration,
            new TestWebHostEnvironment());

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

    private static void Activate(ApplicationDbContext context, string userId, int daysAgo = 0)
    {
        context.AnalyticsEvents.Add(new AnalyticsEvent
        {
            UserId = userId,
            Event = AnalyticsController.FirstChapterEvent,
            Meta = "Alice",
            CreatedAt = DateTime.UtcNow.AddDays(-daysAgo)
        });
    }

    private static void Impression(
        ApplicationDbContext context,
        string userId,
        string eventName,
        int daysAgo,
        string meta = "")
    {
        context.AnalyticsEvents.Add(new AnalyticsEvent
        {
            UserId = userId,
            Event = eventName,
            Meta = meta,
            CreatedAt = DateTime.UtcNow.AddDays(-daysAgo)
        });
    }

    private static async Task<AnalyticsController.PulseEligibility> Ask(
        ApplicationDbContext context,
        string userId)
    {
        var result = await CreateController(context, userId).GetPulseEligibility(default);
        return (AnalyticsController.PulseEligibility)((OkObjectResult)result).Value!;
    }

    [Fact]
    public async Task Reader_WhoNeverOpenedAChapter_IsNotEligible()
    {
        // Вопрос «что бесит в чтении» у нечитающего собирает ответ о желании,
        // а не об опыте: в метрике это значило бы «люди жалуются до чтения».
        using var context = CreateContext();
        await context.SaveChangesAsync();

        var eligibility = await Ask(context, "reader-a");

        Assert.False(eligibility.Eligible);
        Assert.Equal(AnalyticsController.PulseReasonNotActivated, eligibility.Reason);
    }

    [Fact]
    public async Task ActivatedReader_WithoutImpressions_IsEligible()
    {
        using var context = CreateContext();
        Activate(context, "reader-a", daysAgo: 3);
        await context.SaveChangesAsync();

        var eligibility = await Ask(context, "reader-a");

        Assert.True(eligibility.Eligible);
        Assert.Null(eligibility.Reason);
    }

    [Fact]
    public async Task AnsweredToday_IsNotEligibleAgain()
    {
        // Тот же человек на втором устройстве через пять минут не должен
        // встречать второй блок: иначе `beta_pulse_seen` считает устройства.
        using var context = CreateContext();
        Activate(context, "reader-a");
        Impression(context, "reader-a", AnalyticsController.PulseAnsweredEvent, daysAgo: 0, meta: "word");
        await context.SaveChangesAsync();

        var eligibility = await Ask(context, "reader-a");

        Assert.False(eligibility.Eligible);
        Assert.Equal(AnalyticsController.PulseReasonTooRecent, eligibility.Reason);
    }

    [Theory]
    [InlineData("beta_pulse_seen")]
    [InlineData("beta_pulse_answered")]
    [InlineData("beta_pulse_dismissed")]
    public async Task AnyImpressionWithinTheWeek_IsNotEligible(string eventName)
    {
        using var context = CreateContext();
        Activate(context, "reader-a");
        Impression(context, "reader-a", eventName, daysAgo: 6, meta: eventName == AnalyticsController.PulseAnsweredEvent ? "text" : "");
        await context.SaveChangesAsync();

        Assert.False((await Ask(context, "reader-a")).Eligible);
    }

    [Fact]
    public async Task ImpressionEightDaysAgo_IsEligibleAgain()
    {
        using var context = CreateContext();
        Activate(context, "reader-a", daysAgo: 20);
        Impression(context, "reader-a", AnalyticsController.PulseAnsweredEvent, daysAgo: 8, meta: "word");
        await context.SaveChangesAsync();

        var eligibility = await Ask(context, "reader-a");

        Assert.True(eligibility.Eligible);
    }

    [Fact]
    public async Task AnotherReadersImpression_DoesNotBlockThisOne()
    {
        using var context = CreateContext();
        Activate(context, "reader-a");
        Activate(context, "reader-b");
        Impression(context, "reader-b", AnalyticsController.PulseSeenEvent, daysAgo: 0);
        await context.SaveChangesAsync();

        Assert.True((await Ask(context, "reader-a")).Eligible);
        Assert.False((await Ask(context, "reader-b")).Eligible);
    }

    [Fact]
    public void CooldownIsSevenDays()
    {
        Assert.Equal(7, AnalyticsController.PulseCooldownDays);
    }
}

/// <summary>
/// Поле `pulse` в GET /api/analytics/acquisition — то, что менеджер читает
/// вместо того, чтобы самому grepp'ить таблицу событий.
/// </summary>
public class BetaPulseAcquisitionTests
{
    private static ApplicationDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static AnalyticsController CreateReportController(ApplicationDbContext context)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Seeder:Key"] = "admin-secret" })
            .Build();

        return new AnalyticsController(
            context,
            NullLogger<AnalyticsController>.Instance,
            configuration,
            new TestWebHostEnvironment { EnvironmentName = "Production" });
    }

    private static void Pulse(
        ApplicationDbContext context,
        string userId,
        string eventName,
        DateTime createdAt,
        string meta = "")
    {
        context.AnalyticsEvents.Add(new AnalyticsEvent
        {
            UserId = userId,
            Event = eventName,
            Meta = meta,
            CreatedAt = createdAt
        });
    }

    private static async Task<AnalyticsController.AcquisitionReport> Report(
        ApplicationDbContext context,
        int days = 14)
    {
        var result = await CreateReportController(context).Acquisition("admin-secret", days);
        return (AnalyticsController.AcquisitionReport)((OkObjectResult)result).Value!;
    }

    [Fact]
    public async Task Pulse_DaysAndAnswers_ConvergeWithRawEvents()
    {
        using var context = CreateContext();
        var today = DateTime.UtcNow.Date;
        var yesterday = today.AddDays(-1);

        Pulse(context, "a", AnalyticsController.PulseSeenEvent, today);
        Pulse(context, "a", AnalyticsController.PulseSeenEvent, today.AddHours(3));
        Pulse(context, "a", AnalyticsController.PulseAnsweredEvent, today, "word");
        Pulse(context, "b", AnalyticsController.PulseDismissedEvent, today, "dismiss");
        Pulse(context, "c", AnalyticsController.PulseSeenEvent, yesterday);
        Pulse(context, "c", AnalyticsController.PulseAnsweredEvent, yesterday, "repetition");
        Pulse(context, "d", AnalyticsController.PulseAnsweredEvent, yesterday, "word");
        await context.SaveChangesAsync();

        var report = await Report(context);
        var raw = await context.AnalyticsEvents.ToListAsync();

        foreach (var day in report.Pulse.Days)
        {
            var key = DateOnly.Parse(day.Date);
            var rawOfDay = raw.Where(e => DateOnly.FromDateTime(e.CreatedAt) == key).ToArray();

            Assert.Equal(
                rawOfDay.Count(e => e.Event == AnalyticsController.PulseSeenEvent),
                day.Seen);
            Assert.Equal(
                rawOfDay.Count(e => e.Event == AnalyticsController.PulseAnsweredEvent),
                day.Answered);
            Assert.Equal(
                rawOfDay.Count(e => e.Event == AnalyticsController.PulseDismissedEvent),
                day.Dismissed);
        }

        // Итог по вариантам сходится с сырыми ответами, а не с чьим-то пересказом.
        Assert.Equal(
            raw.Count(e => e.Event == AnalyticsController.PulseAnsweredEvent),
            report.Pulse.Answers.Sum(a => a.Count));
        Assert.Equal(
            new[] { ("word", 2), ("repetition", 1) },
            report.Pulse.Answers.Select(a => (a.Option, a.Count)).ToArray());

        // Самый частый вариант — первым, при равных счётчиках по имени: две
        // выгрузки одного дня обязаны читаться одинаково.
        Assert.Equal("word", report.Pulse.Answers.First().Option);
    }

    [Fact]
    public async Task Pulse_KeepsFunnelDaysInTheGridWithZeros()
    {
        // Пустой день остаётся в ответе: «показали 0, ответили 0» — это данные,
        // а не дырка; именно по таким дням видно, что блок вообще не доходил.
        using var context = CreateContext();
        var twoDaysAgo = DateTime.UtcNow.AddDays(-2);

        context.Users.Add(new User
        {
            Id = "u-1",
            UserName = "u-1@example.com",
            Email = "u-1@example.com",
            AcquisitionSource = "vk",
            AcquisitionCode = "post-1",
            CreatedAt = twoDaysAgo
        });
        Pulse(context, "u-1", AnalyticsController.PulseSeenEvent, DateTime.UtcNow);
        await context.SaveChangesAsync();

        var report = await Report(context);
        var funnelDates = report.Funnel.Select(f => f.Date).ToArray();
        var pulseDates = report.Pulse.Days.Select(d => d.Date).ToArray();

        // Дни pulse — надстройка над днями воронки: ни один день воронки не
        // исчез, а порядок тот же.
        Assert.Equal(funnelDates, funnelDates.Intersect(pulseDates).ToArray());
        Assert.Equal(
            funnelDates.OrderBy(d => d, StringComparer.Ordinal),
            funnelDates);

        var quietDay = report.Pulse.Days.Single(d => d.Date == DateOnly.FromDateTime(twoDaysAgo).ToString("yyyy-MM-dd"));
        Assert.Equal(0, quietDay.Seen);
        Assert.Equal(0, quietDay.Answered);
        Assert.Equal(0, quietDay.Dismissed);
    }

    [Fact]
    public async Task Pulse_EventOnlyDay_AppearsEvenWithoutFunnelActivity()
    {
        using var context = CreateContext();
        var yesterday = DateTime.UtcNow.Date.AddDays(-1);

        Pulse(context, "lonely", AnalyticsController.PulseAnsweredEvent, yesterday, "other");
        await context.SaveChangesAsync();

        var report = await Report(context);

        var day = report.Pulse.Days.Single();
        Assert.Equal(DateOnly.FromDateTime(yesterday).ToString("yyyy-MM-dd"), day.Date);
        Assert.Equal(1, day.Answered);
        Assert.Empty(report.Funnel);
    }

    [Fact]
    public async Task Pulse_IgnoresEventsOlderThanTheWindow()
    {
        using var context = CreateContext();
        Pulse(context, "a", AnalyticsController.PulseSeenEvent, DateTime.UtcNow.AddDays(-40));
        await context.SaveChangesAsync();

        var report = await Report(context, 14);

        Assert.Equal(0, report.Pulse.Days.Sum(d => d.Seen));
        Assert.Empty(report.Pulse.Answers);
    }

    [Fact]
    public async Task Pulse_WithoutAnyEvents_IsZerosNotNull()
    {
        using var context = CreateContext();

        var report = await Report(context);

        Assert.NotNull(report.Pulse);
        Assert.Empty(report.Pulse.Answers);
        Assert.All(report.Pulse.Days, d => Assert.Equal(0, d.Seen + d.Answered + d.Dismissed));
    }

    [Fact]
    public async Task Pulse_IsTheLastKeyInAcquisitionJson()
    {
        // Порядок ключей в выгрузке — контракт для скриптов менеджера: новые
        // поля добавляются в конец, старые не сдвигаются.
        using var context = CreateContext();
        var result = await CreateReportController(context).Acquisition("admin-secret");
        var json = JsonSerializer.Serialize(
            ((OkObjectResult)result).Value!,
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        using var document = JsonDocument.Parse(json);
        var keys = document.RootElement.EnumerateObject().Select(p => p.Name).ToArray();

        Assert.Equal(
            new[]
            {
                "days", "since", "rows", "byChannel", "totals",
                "funnel", "byLevel", "guest", "pulse"
            },
            keys);

        var pulse = document.RootElement.GetProperty("pulse");
        Assert.Equal(
            new[] { "days", "answers" },
            pulse.EnumerateObject().Select(p => p.Name).ToArray());
    }
}
