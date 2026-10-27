using System.Security.Claims;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Tests.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// W2.1.3 — активационное событие `chapter_opened_first`.
///
/// Через неделю беты нужно отличать «зарегистрировался и ушёл» от «начал читать».
/// Это одна метрика: первая открытая глава. Чтобы она не зависела от честности
/// клиента, дубли отсекает сервер — повторный запрос с тем же пользователем
/// ничего не дописывает, а индекс в БД не даёт вставить второй строки даже при
/// гонке двух параллельных запросов.
/// </summary>
public class ChapterOpenedFirstTests
{
    private const string EventName = "chapter_opened_first";

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

    private static AnalyticsEventDto FirstChapterOpened(string bookTitle) => new()
    {
        Event = EventName,
        Meta = bookTitle
    };

    [Fact]
    public async Task ChapterOpenedFirst_IsAcceptedAndStored()
    {
        using var context = CreateContext();
        var controller = CreateController(context, "user-a");

        var result = await controller.Track(FirstChapterOpened("Alice in Wonderland"));

        Assert.IsType<OkResult>(result);
        Assert.Equal(1, await context.AnalyticsEvents.CountAsync(ae => ae.Event == EventName));
    }

    [Fact]
    public async Task ChapterOpenedFirst_TwiceBySameUser_WritesOnlyOneEvent()
    {
        using var context = CreateContext();
        var controller = CreateController(context, "user-a");

        await controller.Track(FirstChapterOpened("Alice in Wonderland"));
        // Читалка перемонтировалась, пользователь открыл вторую книгу, клиент
        // ошибочно прислал событие снова — вторая запись ничего не добавляет.
        var second = await controller.Track(FirstChapterOpened("Sherlock Holmes"));

        Assert.IsType<OkResult>(second);
        Assert.Equal(1, await context.AnalyticsEvents.CountAsync(ae => ae.Event == EventName));
    }

    [Fact]
    public async Task ChapterOpenedFirst_ForDifferentUsers_WritesOneEventEach()
    {
        using var context = CreateContext();

        await CreateController(context, "user-a").Track(FirstChapterOpened("Alice"));
        await CreateController(context, "user-b").Track(FirstChapterOpened("Alice"));

        Assert.Equal(2, await context.AnalyticsEvents.CountAsync(ae => ae.Event == EventName));
    }

    [Fact]
    public async Task OtherEvents_AreStillRepeated()
    {
        // Дедупликация касается только активационного события: `book_opened`
        // намеренно пишется на каждое открытие книги.
        using var context = CreateContext();
        var controller = CreateController(context, "user-a");

        await controller.Track(new AnalyticsEventDto { Event = "book_opened", Meta = "Alice" });
        await controller.Track(new AnalyticsEventDto { Event = "book_opened", Meta = "Sherlock" });

        Assert.Equal(2, await context.AnalyticsEvents.CountAsync(ae => ae.Event == "book_opened"));
    }

    [Fact]
    public async Task UnknownEvent_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context, "user-a");

        var result = await controller.Track(new AnalyticsEventDto { Event = "anything_else" });

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(await context.AnalyticsEvents.ToListAsync());
    }
}

/// <summary>
/// Тот же контракт на настоящем SQL: частичный уникальный индекс держит
/// однократность даже если два запроса прошли проверку в контроллере одновременно.
/// SQLite выбран потому, что фильтр индекса должен оставаться корректным и для
/// тестового провайдера — проверка падает ровно там, где кривой DDL.
/// </summary>
public class ChapterOpenedFirstIndexTests
{
    private const string EventName = "chapter_opened_first";

    private static async Task<ApplicationDbContext> CreateSchemaAsync(SqliteConnection connection)
    {
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseSqlite(connection)
                .Options);
        await context.Database.EnsureCreatedAsync();

        context.Users.Add(new User
        {
            Id = "user-a",
            UserName = "user-a@example.com",
            NormalizedUserName = "USER-A@EXAMPLE.COM"
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        return context;
    }

    [Fact]
    public async Task SecondRowForSameUser_IsRejectedByDatabase()
    {
        await using var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();
        await using var context = await CreateSchemaAsync(connection);

        context.AnalyticsEvents.Add(new AnalyticsEvent { UserId = "user-a", Event = EventName });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        context.AnalyticsEvents.Add(new AnalyticsEvent { UserId = "user-a", Event = EventName });
        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task IndexDoesNotBlockOtherEvents()
    {
        await using var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();
        await using var context = await CreateSchemaAsync(connection);

        // Тот же пользователь и та же строка события, но другое имя — не под индекс
        context.AnalyticsEvents.Add(new AnalyticsEvent { UserId = "user-a", Event = "book_opened" });
        context.AnalyticsEvents.Add(new AnalyticsEvent { UserId = "user-a", Event = "book_opened" });
        await context.SaveChangesAsync();

        Assert.Equal(2, await context.AnalyticsEvents.CountAsync(ae => ae.Event == "book_opened"));
    }
}
