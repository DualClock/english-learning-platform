using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Выдача новостей на главной.
///
/// Три свойства, каждое из которых при ошибке делает блок либо бесполезным,
/// либо вредным:
///
///  1. Потолок пять карточек действует на СЕРВЕРЕ. Если ограничение живёт
///     только в вёрстке, другой клиент (мобильное приложение, скрипт) получит
///     сотню и превратит главную в ленту.
///  2. Скрытая админом новость не показывается никому.
///  3. Интересы меняют приоритет, но не выключают ленту: человек с редким
///     интересом не должен видеть пустой экран при живом блоке.
/// </summary>
public class NewsFeedTests
{
    private static ApplicationDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static NewsItem News(
        string title, string? level = "A2", string topics = "news",
        int daysAgo = 0, bool hidden = false) =>
        new()
        {
            ExternalId = Guid.NewGuid().ToString("N"),
            Title = title,
            Summary = "Краткое описание",
            BodyHtml = "<p>Текст</p>",
            SourceName = "News in Levels",
            SourceUrl = $"https://example.com/{Guid.NewGuid():N}",
            Level = level,
            Topics = topics,
            PublishedAt = DateTime.UtcNow.AddDays(-daysAgo),
            FetchedAt = DateTime.UtcNow,
            IsHidden = hidden
        };

    private static async Task SeedUserAsync(ApplicationDbContext context, string userId = "u1")
    {
        context.Users.Add(new User
        {
            Id = userId,
            UserName = $"{userId}@example.com",
            NormalizedUserName = $"{userId}@EXAMPLE.COM",
            Email = $"{userId}@example.com",
            NormalizedEmail = $"{userId}@EXAMPLE.COM"
        });
        await context.SaveChangesAsync();
    }

    /// <summary>
    /// Контроллер с заданным пользователем.
    ///
    /// Без HttpContext `User` бросает NullReferenceException внутри MVC, и тест
    /// проверял бы не фильтр по интересам, а отсутствие контекста. Заодно
    /// NewsController научен работать без контекста (гость), поэтому здесь
    /// нужен контекст с явным claim'ом.
    /// </summary>
    private static NewsController ControllerFor(ApplicationDbContext context, string? userId)
    {
        var controller = new NewsController(context);
        var identity = userId == null
            ? new System.Security.Claims.ClaimsIdentity()
            : new System.Security.Claims.ClaimsIdentity(
                new[] { new System.Security.Claims.Claim(
                    System.Security.Claims.ClaimTypes.NameIdentifier, userId) },
                "Bearer");

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext
            {
                User = new System.Security.Claims.ClaimsPrincipal(identity)
            }
        };
        return controller;
    }

    /// <summary>
    /// Разбирает ответ контроллера в JSON, не полагаясь на форму анонимного
    /// типа. Возвращаемся к JsonElement: тест не должен зависеть от того,
    /// как названы свойства во внутреннем объекте.
    /// </summary>
    private static System.Text.Json.JsonElement Body(ActionResult<object> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var json = System.Text.Json.JsonSerializer.Serialize(ok.Value);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static List<string> Titles(System.Text.Json.JsonElement root)
    {
        var items = root.GetProperty("items");
        return Enumerable.Range(0, items.GetArrayLength())
            .Select(i => items[i].GetProperty("Title").GetString() ?? "")
            .ToList();
    }

    // ─────────────────────────────────────────────────────── потолок выдачи

    [Fact]
    public async Task ForMe_ReturnsAtMostFive_EvenIfAskedForMore()
    {
        using var context = CreateContext();
        for (var i = 0; i < 20; i++) context.NewsItems.Add(News($"Новость {i}"));
        await context.SaveChangesAsync();

        var controller = new NewsController(context);
        var root = Body(await controller.ForMe(level: "A2", take: 100, ct: default));

        var items = root.GetProperty("items");
        Assert.Equal(5, items.GetArrayLength());
    }

    [Fact]
    public async Task ForMe_RespectsSmallerTake()
    {
        using var context = CreateContext();
        for (var i = 0; i < 10; i++) context.NewsItems.Add(News($"Новость {i}"));
        await context.SaveChangesAsync();

        var controller = new NewsController(context);
        var root = Body(await controller.ForMe(level: "A2", take: 2, ct: default));

        Assert.Equal(2, root.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task ForMe_FiltersByExactLevel()
    {
        using var context = CreateContext();
        context.NewsItems.AddRange(
            News("Простое", level: "A1"),
            News("Среднее", level: "A2"),
            News("Сложное", level: "C1"));
        await context.SaveChangesAsync();

        var controller = new NewsController(context);
        var root = Body(await controller.ForMe(level: "a2", ct: default));

        var items = root.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal("Среднее", items[0].GetProperty("Title").GetString());
    }

    [Fact]
    public async Task ForMe_NewsWithoutLevel_IsNotShownInLevelFeed()
    {
        // Лучше не показать, чем показать C1 первогодке под видом A2.
        using var context = CreateContext();
        context.NewsItems.AddRange(
            News("Без уровня", level: null),
            News("С уровнем", level: "A2"));
        await context.SaveChangesAsync();

        var controller = new NewsController(context);
        var root = Body(await controller.ForMe(level: "A2", ct: default));

        Assert.Equal(1, root.GetProperty("items").GetArrayLength());
    }

    // ─────────────────────────────────────────────────────── скрытие

    [Fact]
    public async Task ForMe_HiddenNews_NeverAppears()
    {
        using var context = CreateContext();
        context.NewsItems.AddRange(
            News("Видимая", hidden: false),
            News("Скрытая", hidden: true));
        await context.SaveChangesAsync();

        var controller = new NewsController(context);
        var root = Body(await controller.ForMe(level: "A2", ct: default));

        var titles = Titles(root);

        Assert.Contains("Видимая", titles);
        Assert.DoesNotContain("Скрытая", titles);
    }

    // ─────────────────────────────────────────────────────── интересы

    [Fact]
    public async Task ForMe_WithMatchingInterest_PutsItFirst()
    {
        using var context = CreateContext();
        await SeedUserAsync(context);

        context.NewsItems.AddRange(
            News("Про политику", topics: "news", daysAgo: 0),
            News("Про спорт", topics: "sport", daysAgo: 3));
        context.UserInterests.Add(new UserInterest { UserId = "u1", Interest = "sport" });
        await context.SaveChangesAsync();

        var controller = ControllerFor(context, "u1");
        var root = Body(await controller.ForMe(level: "A2", ct: default));

        // Спорт старее, но интерес человека важнее свежести в пределах выдачи.
        Assert.Equal("Про спорт",
            root.GetProperty("items")[0].GetProperty("Title").GetString());
    }

    [Fact]
    public async Task ForMe_WithoutMatchingInterest_StillReturnsSomething()
    {
        // Редкий интерес не должен давать пустой экран при живом блоке.
        using var context = CreateContext();
        await SeedUserAsync(context);

        context.NewsItems.Add(News("Про политику", topics: "news"));
        context.UserInterests.Add(new UserInterest { UserId = "u1", Interest = "science" });
        await context.SaveChangesAsync();

        var controller = ControllerFor(context, "u1");
        var root = Body(await controller.ForMe(level: "A2", ct: default));

        Assert.Equal(1, root.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task ForMe_NoNewsAtAll_ReturnsEmptyAndNoMore()
    {
        using var context = CreateContext();
        var controller = new NewsController(context);

        var root = Body(await controller.ForMe(level: "A2", ct: default));

        Assert.Equal(0, root.GetProperty("items").GetArrayLength());
        Assert.False(root.GetProperty("hasMore").GetBoolean());
    }

    [Fact]
    public async Task ForMe_SplitsTopicsIntoTags()
    {
        using var context = CreateContext();
        context.NewsItems.Add(News("Тема", topics: "news,sport"));
        await context.SaveChangesAsync();

        var controller = new NewsController(context);
        var root = Body(await controller.ForMe(level: "A2", ct: default));

        var topics = root.GetProperty("items")[0].GetProperty("topics");
        Assert.Equal(2, topics.GetArrayLength());
    }

    // ─────────────────────────────────────────────────── интересы: запись

    [Fact]
    public async Task ReplaceInterests_ReplacesWholeSet()
    {
        using var context = CreateContext();
        await SeedUserAsync(context);
        context.UserInterests.Add(new UserInterest { UserId = "u1", Interest = "sport" });
        await context.SaveChangesAsync();

        var controller = new InterestsController(context)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext
                {
                    User = new System.Security.Claims.ClaimsPrincipal(
                        new System.Security.Claims.ClaimsIdentity(
                            new[] { new System.Security.Claims.Claim(
                                System.Security.Claims.ClaimTypes.NameIdentifier, "u1") },
                            "Bearer"))
                }
            }
        };

        await controller.Replace(new InterestsDto(new[] { "science", "tech" }), default);

        var stored = await context.UserInterests.Where(i => i.UserId == "u1")
            .Select(i => i.Interest).OrderBy(i => i).ToListAsync();

        // Спорт снят, наука и техника добавлены — именно замена, а не дозапись.
        Assert.Equal(new[] { "science", "tech" }, stored);
    }
}
