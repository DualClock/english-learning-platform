using System.Security.Claims;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services.Articles;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Публичный контроллер статей.
///
/// Главные инварианты: черновик и архив НЕ видны читателю (иначе «черновик»
/// — это просто флаг без смысла), а удалённая статья отдаёт 404, а не 500 —
/// на неё могли остаться ссылки из старых постов.
/// </summary>
public class ArticlesControllerTests
{
    private static ApplicationDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("articles-" + Guid.NewGuid())
            .Options;

        var context = new ApplicationDbContext(options);

        context.ArticleSections.Add(new ArticleSection
        {
            Id = 1,
            Name = "Грамматика",
            Slug = "grammar",
            SortOrder = 1,
        });
        context.SaveChanges();

        return context;
    }

    private static ArticlesController ControllerFor(ApplicationDbContext context, string? userId = null)
    {
        var controller = new ArticlesController(context, new MarkdownRenderer());
        var identity = userId == null
            ? new ClaimsIdentity()
            : new ClaimsIdentity(
                new[] { new Claim(ClaimTypes.NameIdentifier, userId) }, "Bearer");

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(identity),
            },
        };
        return controller;
    }

    private static Article Article(
        string slug,
        string title,
        string status,
        int sectionId = 1,
        DateTime? publishedAt = null) => new()
    {
        Slug = slug,
        Title = title,
        Status = status,
        SectionId = sectionId,
        PublishedAt = publishedAt ?? (status == ArticleStatus.Published ? DateTime.UtcNow : null),
        BodyMarkdown = "Текст",
        BodyHtml = "<p>Текст</p>",
    };

    [Fact]
    public async Task Список_отдаёт_только_опубликованные()
    {
        var context = NewContext();
        context.Articles.AddRange(
            Article("first", "Первая", ArticleStatus.Published),
            Article("draft-one", "Черновик", ArticleStatus.Draft),
            Article("old", "Архив", ArticleStatus.Archived));
        await context.SaveChangesAsync();

        var result = await ControllerFor(context).List(section: null, ct: default);

        var items = Body(result);
        Assert.Equal(1, items.GetProperty("items").GetArrayLength());
        Assert.Equal("first", items.GetProperty("items")[0].GetProperty("slug").GetString());
    }

    [Theory]
    [InlineData(ArticleStatus.Draft)]
    [InlineData(ArticleStatus.Archived)]
    public async Task Неопубликованная_статья_не_открывается_по_ссылке(string status)
    {
        var context = NewContext();
        context.Articles.Add(Article("hidden", "Скрытая", status));
        await context.SaveChangesAsync();

        var result = await ControllerFor(context).GetBySlug("hidden", default);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Опубликованная_статья_открывается_по_ссылке()
    {
        var context = NewContext();
        context.Articles.Add(Article("visible", "Видимая", ArticleStatus.Published));
        await context.SaveChangesAsync();

        var result = await ControllerFor(context).GetBySlug("visible", default);

        var view = Body(result);
        Assert.Equal("Видимая", view.GetProperty("title").GetString());
        Assert.Equal("Грамматика", view.GetProperty("sectionName").GetString());
    }

    [Fact]
    public async Task Удалённая_статья_даёт_404_а_не_500()
    {
        // На удалённую статью могли остаться ссылки из старых постов:
        // 404 на неё — нормальный ответ, а не падение.
        var context = NewContext();
        var article = Article("gone", "Удалённая", ArticleStatus.Published);
        article.DeletedAt = DateTime.UtcNow;
        context.Articles.Add(article);
        await context.SaveChangesAsync();

        var result = await ControllerFor(context).GetBySlug("gone", default);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Список_фильтрует_по_разделу()
    {
        var context = NewContext();
        context.ArticleSections.Add(new ArticleSection { Id = 2, Name = "Лексика", Slug = "vocab" });
        context.Articles.AddRange(
            Article("g1", "Грамматика", ArticleStatus.Published, sectionId: 1),
            Article("v1", "Лексика", ArticleStatus.Published, sectionId: 2));
        await context.SaveChangesAsync();

        var result = await ControllerFor(context).List(section: "vocab", ct: default);

        var items = Body(result);
        Assert.Equal(1, items.GetProperty("items").GetArrayLength());
        Assert.Equal("v1", items.GetProperty("items")[0].GetProperty("slug").GetString());
    }

    [Fact]
    public async Task Разделы_идут_в_заданном_порядке()
    {
        var context = NewContext();
        context.ArticleSections.Add(new ArticleSection { Name = "Раньше", Slug = "early", SortOrder = 0 });
        context.ArticleSections.Add(new ArticleSection { Name = "Удалённый", Slug = "deleted", SortOrder = 5, DeletedAt = DateTime.UtcNow });
        await context.SaveChangesAsync();

        var result = await ControllerFor(context).Sections(default);

        var items = Body(result);
        Assert.Equal(2, items.GetProperty("items").GetArrayLength());
        Assert.Equal("early", items.GetProperty("items")[0].GetProperty("slug").GetString());
    }

    [Fact]
    public async Task Список_отсортирован_по_дате_публикации()
    {
        var context = NewContext();
        context.Articles.AddRange(
            Article("older", "Старая", ArticleStatus.Published, publishedAt: DateTime.UtcNow.AddDays(-10)),
            Article("newer", "Новая", ArticleStatus.Published, publishedAt: DateTime.UtcNow));
        await context.SaveChangesAsync();

        var result = await ControllerFor(context).List(section: null, ct: default);

        var items = Body(result);
        Assert.Equal("newer", items.GetProperty("items")[0].GetProperty("slug").GetString());
    }

    [Fact]
    public async Task Анонс_выводится_из_тела_если_не_задан()
    {
        var context = NewContext();
        var article = Article("auto", "Авто", ArticleStatus.Published);
        article.Summary = null;
        article.BodyMarkdown = "## Заголовок\n\nПервый абзац, из которого берётся анонс.";
        context.Articles.Add(article);
        await context.SaveChangesAsync();

        var result = await ControllerFor(context).GetBySlug("auto", default);

        var summary = Body(result).GetProperty("summary").GetString();
        Assert.Contains("Первый абзац", summary);
        Assert.DoesNotContain("#", summary);
    }

    [Fact]
    public async Task Тело_отдаётся_готовым_html()
    {
        var context = NewContext();
        var article = Article("body", "Тело", ArticleStatus.Published);
        article.BodyHtml = "<p>Отрендерено</p>";
        context.Articles.Add(article);
        await context.SaveChangesAsync();

        var result = await ControllerFor(context).GetBySlug("body", default);

        Assert.Equal("<p>Отрендерено</p>", Body(result).GetProperty("bodyHtml").GetString());
    }

    [Fact]
    public void Контроллер_требует_роль_Админа_на_админских_методах()
    {
        // Публичные методы (List/GetBySlug/Sections) роли не требуют.
        // Админские (Create/Update/Publish) обязаны иметь [Authorize(Roles)].
        var type = typeof(ArticlesController);

        var adminMethods = new[] { "AdminList", "Create", "Update", "Publish", "Archive", "Delete", "Restore" };

        foreach (var name in adminMethods)
        {
            var method = type.GetMethods().FirstOrDefault(m => m.Name == name);
            Assert.True(method != null, $"нет метода {name}");

            var hasRoles = method!.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
                .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
                .Any(a => a.Roles != null && a.Roles.Contains("Admin"));

            var hasClassLevel = type.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
                .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
                .Any(a => a.Roles != null && a.Roles.Contains("Admin"));

            Assert.True(hasRoles || hasClassLevel, $"{name} не защищён ролью Admin");
        }
    }

    private static System.Text.Json.JsonElement Body(IActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        var json = System.Text.Json.JsonSerializer.Serialize(ok.Value, new System.Text.Json.JsonSerializerOptions
        {
            PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
        });
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
