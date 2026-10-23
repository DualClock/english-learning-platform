using System.Text.Json;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// W2.2c, задача 1: анонимный read-слой /library.
///
/// Эндпоинт отдаёт каталог без сессии — значит приватность больше не обеспечивает
/// транспорт, её обеспечивает код. Проверяемое здесь:
///  - книга, у которой есть владелец (пользовательский EPUB), не появляется ни в
///    списке, ни по прямому слагу;
///  - наружу не уходят FilePath и UploadedByUserId;
///  - слаг детерминирован, устойчив к регистру и к коллизии названий;
///  - без боевой БД каталог всё равно непустой (фронт собирается офлайн).
/// </summary>
public class PublicCatalogPrivacyTests : IDisposable
{
    private readonly PublicCatalogHarness _harness = new();

    public void Dispose() => _harness.Dispose();

    [Fact]
    public async Task Catalog_IsAllowAnonymous_AndHasPublicRoute()
    {
        var type = typeof(CatalogController);

        Assert.NotEmpty(type.GetCustomAttributes(typeof(AllowAnonymousAttribute), true));

        // Класс без [Authorize]: анонимность здесь — решение, а не отсутствие
        // атрибута по невнимательности, и исчезнуть «случайно» он не должен
        Assert.Empty(type.GetCustomAttributes(typeof(AuthorizeAttribute), true));

        var route = Assert.Single(type.GetCustomAttributes(typeof(RouteAttribute), true));
        Assert.Equal("api/catalog", ((RouteAttribute)route).Template);

        // Контроллер вызывается без HttpContext с пользователем — ровно так же,
        // как MVC вызывает [AllowAnonymous]-экшен
        var controller = await _harness.CreateControllerAsync();
        Assert.IsType<OkObjectResult>(await controller.GetBooks(default));
    }

    [Fact]
    public async Task Catalog_ContainsNoBookWithAnOwner()
    {
        var controller = await _harness.CreateControllerAsync(async (context, environment) =>
        {
            var seeder = new StorySeeder(context, environment, Microsoft.Extensions.Logging.Abstractions.NullLogger<StorySeeder>.Instance);

            // Приватный экземпляр с реальным EPUB на диске: рассказ пользователя
            await seeder.CreateBookForUserAsync("user-1", new StorySeedData
            {
                Title = "My Grandmother Recipes",
                Author = "user-1",
                CefrLevel = "a2",
                Description = "private upload",
                Paragraphs = new List<string> { "A private file that nobody else may read." }
            }, 0);

            // Пользовательские копии известных названий: они не должны ни
            // обогатить сид, ни попасть в список второй строкой
            context.Books.Add(PublicCatalogHarness.PrivateBook(102, "Pride and Prejudice", "user-2", words: 120_000));
            context.Books.Add(PublicCatalogHarness.PrivateBook(103, "The Lost Kitten", "user-3"));

            // Единственный гость из таблицы Books — строка без владельца
            context.Books.Add(PublicCatalogHarness.SystemBook(104, "Sea Stories From The Archive", words: 512));
        });

        var result = Assert.IsType<OkObjectResult>(await controller.GetBooks(default));
        var response = Assert.IsType<CatalogResponse>(result.Value);
        var titles = response.Books.Select(b => b.Title).ToList();

        Assert.DoesNotContain("My Grandmother Recipes", titles);
        Assert.Contains("Sea Stories From The Archive", titles);

        // Классика и рассказы из сидов обязаны быть: иначе витрина пуста
        Assert.Contains("Alice's Adventures in Wonderland", titles);
        Assert.Contains("The Lost Kitten", titles);
        Assert.Contains("Pride and Prejudice", titles);
        Assert.True(response.Count >= 13, $"каталог слишком короткий: {response.Count}");

        // Приватная копия классики не должна подтянуть ни объём, ни идентификаторы
        var pride = response.Books.Single(b => b.Title == "Pride and Prejudice");
        Assert.Equal("1342", pride.GutenbergId);
        Assert.Null(pride.WordCount);
    }

    [Fact]
    public async Task Catalog_EmptyDatabase_StillServesSeedCatalog()
    {
        // Бэкенд без боевой БД (локальная сборка фронтенда, CI) обязан отдавать
        // непустой каталог: витрина строится на сидах, а не на строках таблицы
        var catalog = await _harness.CreateCatalogAsync();
        var books = await catalog.GetCatalogAsync();

        Assert.NotEmpty(books);
        Assert.Contains(books, b => b.Kind == CatalogKinds.Story);
        Assert.Contains(books, b => b.Kind == CatalogKinds.Classic);
        Assert.All(books, b => Assert.False(string.IsNullOrWhiteSpace(b.Slug)));
    }

    [Fact]
    public async Task DirectSlugLookup_OfPrivateBook_IsNotFound()
    {
        var catalog = await _harness.CreateCatalogAsync((context, _) =>
        {
            context.Books.Add(PublicCatalogHarness.PrivateBook(201, "My Grandmother Recipes", "user-1"));
            return Task.CompletedTask;
        });

        Assert.Null(await catalog.FindAsync("my-grandmother-recipes"));

        var controller = new CatalogController(catalog);
        var result = Assert.IsType<NotFoundObjectResult>(
            await controller.GetBook("my-grandmother-recipes", default));
        Assert.Equal(404, result.StatusCode);
    }

    [Fact]
    public async Task Response_HasNoPrivateFields()
    {
        var controller = await _harness.CreateControllerAsync((context, _) =>
        {
            context.Books.Add(PublicCatalogHarness.SystemBook(
                301, "Sea Stories From The Archive", "/uploads/books/secret.epub", words: 300));
            return Task.CompletedTask;
        });

        var result = Assert.IsType<OkObjectResult>(await controller.GetBooks(default));
        var json = JsonSerializer.Serialize(
            result.Value,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

        foreach (var forbidden in new[]
                 {
                     "filePath", "uploadedbyuserid", "userid", "progress",
                     "currentpage", "totalpages", "interaction"
                 })
        {
            Assert.DoesNotContain(forbidden, json, StringComparison.OrdinalIgnoreCase);
        }

        // Типизированный DTO вместо анонимного объекта из Book: «пробросить»
        // новое приватное поле можно только руками через этот список
        var privateMembers = typeof(PublicBookDto)
            .GetProperties()
            .Select(p => p.Name)
            .Where(n => n.Contains("FilePath", StringComparison.OrdinalIgnoreCase) ||
                        n.Contains("Uploaded", StringComparison.OrdinalIgnoreCase) ||
                        n.Contains("UserId", StringComparison.OrdinalIgnoreCase) ||
                        n.Contains("Progress", StringComparison.OrdinalIgnoreCase) ||
                        n.Contains("Interaction", StringComparison.OrdinalIgnoreCase))
            .ToList();

        Assert.Empty(privateMembers);
    }

    [Fact]
    public async Task SlugLookup_IsCaseInsensitive_AndToleratesTrailingSlash()
    {
        var catalog = await _harness.CreateCatalogAsync();

        var canonical = await catalog.FindAsync("alices-adventures-in-wonderland");
        var shouted = await catalog.FindAsync("ALICES-ADVENTURES-IN-WONDERLAND");
        var slashed = await catalog.FindAsync("alices-adventures-in-wonderland/");

        Assert.NotNull(canonical);
        Assert.NotNull(shouted);
        Assert.NotNull(slashed);
        Assert.Equal(canonical!.Title, shouted!.Title);
        Assert.Equal(canonical.Slug, slashed!.Slug);

        // Адреса, которого нет в каталоге, — 404, а не «первая похожая книга»
        Assert.Null(await catalog.FindAsync("alice-s-adventures-in-wonderland"));
        Assert.Null(await catalog.FindAsync(""));
        Assert.Null(await catalog.FindAsync("moby"));
    }

    [Fact]
    public async Task SameTitleTwice_GetsUniqueSlugsAndBothResolve()
    {
        var catalog = await _harness.CreateCatalogAsync((context, _) =>
        {
            context.Books.Add(PublicCatalogHarness.SystemBook(501, "Sea Stories", words: 100));
            context.Books.Add(PublicCatalogHarness.SystemBook(502, "Sea Stories", words: 200));
            return Task.CompletedTask;
        });

        var books = await catalog.GetCatalogAsync();
        var twins = books.Where(b => b.Title == "Sea Stories").ToList();

        Assert.Equal(2, twins.Count);
        Assert.Equal(2, twins.Select(b => b.Slug).Distinct(StringComparer.Ordinal).Count());
        Assert.Contains(twins, b => b.Slug == "sea-stories");
        Assert.Contains(twins, b => b.Slug == "sea-stories-2");

        // Каждый адрес ведёт ровно на одну книгу, а не на «первую попавшуюся»
        Assert.Equal(100, (await catalog.FindAsync("sea-stories"))!.WordCount);
        Assert.Equal(200, (await catalog.FindAsync("sea-stories-2"))!.WordCount);
    }

    [Fact]
    public async Task Catalog_IsCached_SecondCallSkipsRebuild()
    {
        var catalog = await _harness.CreateCatalogAsync((context, _) =>
        {
            context.Books.Add(PublicCatalogHarness.SystemBook(601, "Sea Stories From The Archive"));
            return Task.CompletedTask;
        });

        var before = await catalog.GetCatalogAsync();

        _harness.Context.Books.Add(PublicCatalogHarness.SystemBook(602, "Late Night Tales"));
        await _harness.Context.SaveChangesAsync();

        var after = await catalog.GetCatalogAsync();

        // Кэш — часть дизайна: краулер не пересобирает каталог на каждый запрос.
        // Значит сразу после записи в БД список ещё старый, а не «плывущий».
        Assert.Equal(before.Count, after.Count);
        Assert.DoesNotContain(after, b => b.Title == "Late Night Tales");
    }

    [Fact]
    public async Task LevelsAreUppercase_AndCoversUsePublicPaths()
    {
        var catalog = await _harness.CreateCatalogAsync();

        var story = await catalog.FindAsync("the-lost-kitten");
        Assert.NotNull(story);
        Assert.Equal("A1", story!.CefrLevel);
        Assert.StartsWith("/uploads/covers/", story.CoverUrl);
        Assert.Equal(CatalogKinds.Story, story.Kind);
        Assert.Null(story.GutenbergId);

        var classic = await catalog.FindAsync("frankenstein");
        Assert.NotNull(classic);
        Assert.Equal(CatalogKinds.Classic, classic!.Kind);
        Assert.StartsWith("https://covers.openlibrary.org/", classic.CoverUrl);
        Assert.Equal("84", classic.GutenbergId);
    }

    [Fact]
    public async Task Catalog_IsSortedByLevel_TheWayTheShelfReadsIt()
    {
        var catalog = await _harness.CreateCatalogAsync();
        var levels = (await catalog.GetCatalogAsync())
            .Select(b => PublicSlug.LevelOrder(b.CefrLevel))
            .ToList();

        // Порядок детерминирован и идёт от A1 к C1: на него смотрит и человек,
        // и sitemap, и суффиксы коллизий
        Assert.Equal(levels.OrderBy(x => x), levels);
    }
}
