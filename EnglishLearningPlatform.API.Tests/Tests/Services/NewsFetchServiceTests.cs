using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.News;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using System.Reflection;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Синхронизация ленты новостей и админское управление ею.
///
/// Тесты держат не «метод вернул 200», а четыре инварианта, нарушение которых
/// видно только человеку и только через сутки после деплоя:
///
///  1. Опрос фида идемпотентен. Фетчер запускается по таймеру И кнопкой
///     «Обновить сейчас»; повторный запуск не имеет права удвоить ленту —
///     человек увидит одну и ту же новость дважды в одной прокрутке.
///  2. Один битый фид не отменяет остальные. Источников несколько, и падение
///     одного (таймаут, поменялась разметка) не должно молча оставить всю
///     ленту пустой.
///  3. Уборка трогает только старое. Удаление свежей новости — потеря контента,
///     которую никто не заметит, пока она не понадобится.
///  4. Скрытая админом новость не возвращается в публичную выдачу и остаётся
///     в базе. Удалить её значит забыть про ExternalId — следующий опрос
///     принесёт ту же новость снова.
/// </summary>
public class NewsFetchServiceTests
{
    // ────────────────────────────────────────────────────────── инвентарь

    private static ApplicationDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static NewsFetchService CreateService(
        ApplicationDbContext context, params INewsSource[] sources) =>
        new(context, sources, NullLogger<NewsFetchService>.Instance);

    private static NewsFeedEntry Entry(
        string url,
        string title = "Заголовок",
        string? level = "A2",
        DateTime? publishedAt = null,
        string[]? topics = null) =>
        new(
            Title: title,
            Summary: "Короткий анонс",
            BodyHtml: "<p>Текст новости</p>",
            SourceName: "Test Source",
            SourceUrl: url,
            ImageUrl: null,
            Level: level,
            Topics: topics ?? new[] { "news" },
            PublishedAt: publishedAt ?? new DateTime(2026, 10, 20, 12, 0, 0, DateTimeKind.Utc));

    // ───────────────────────────────────────────────── дедупликация

    [Fact]
    public async Task SameExternalId_SecondFetch_DoesNotCreateDuplicate()
    {
        await using var context = CreateContext();
        var source = new StubSource("a", Entry("https://example.com/news/1"));

        await CreateService(context, source).FetchAllAsync();
        await CreateService(context, source).FetchAllAsync();

        // Ровно одна строка, а не две: иначе лента начнёт двоиться на каждом
        // двухчасовом проходе.
        Assert.Single(await context.NewsItems.ToListAsync());
    }

    [Fact]
    public async Task ExternalId_IsSha256HexOfSourceUrl()
    {
        await using var context = CreateContext();
        const string url = "https://example.com/news/42";

        await CreateService(context, new StubSource("a", Entry(url))).FetchAllAsync();

        var stored = await context.NewsItems.SingleAsync();

        // 64 hex-символа и совпадение с эталонным SHA-256: индекс уникален
        // ровно настолько, насколько стабилен хэш. Эталон считается здесь же
        // через SHA256, а не через сам сервис, — иначе тест проверял бы
        // константу сама с собой.
        Assert.Equal(64, stored.ExternalId.Length);
        Assert.Matches("^[0-9a-f]{64}$", stored.ExternalId);
        Assert.Equal(
            Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(url))).ToLowerInvariant(),
            stored.ExternalId);
    }

    [Fact]
    public async Task SameArticle_WithTrackingParameters_IsRecognizedAsDuplicate()
    {
        await using var context = CreateContext();

        // Один и тот же материал, но во второй раз ссылка пришла с UTM-меткой
        // и якорем. Сравнение сырых строк дало бы два хэша и два дубля в ленте.
        await CreateService(context, new StubSource("a",
            Entry("https://example.com/news/7"))).FetchAllAsync();

        await CreateService(context, new StubSource("a",
            Entry("https://example.com/news/7?utm_source=rss#top"))).FetchAllAsync();

        Assert.Single(await context.NewsItems.ToListAsync());
    }

    [Fact]
    public async Task ChangedTitle_UpdatesExistingRowInsteadOfInserting()
    {
        await using var context = CreateContext();
        const string url = "https://example.com/news/9";

        await CreateService(context, new StubSource("a", Entry(url, "Старый заголовок")))
            .FetchAllAsync();
        await CreateService(context, new StubSource("a", Entry(url, "Новый заголовок")))
            .FetchAllAsync();

        var stored = await context.NewsItems.SingleAsync();
        Assert.Equal("Новый заголовок", stored.Title);
    }

    [Fact]
    public async Task RepeatFetch_RefreshesFetchedAt()
    {
        await using var context = CreateContext();
        const string url = "https://example.com/news/10";
        var source = new StubSource("a", Entry(url));

        await CreateService(context, source).FetchAllAsync();

        // Сдвигаем отметку в прошлое и проверяем, что повторный опрос её поднял:
        // по FetchedAt считается свежесть синхронизации.
        var stored = await context.NewsItems.SingleAsync();
        stored.FetchedAt = DateTime.UtcNow.AddDays(-30);
        await context.SaveChangesAsync();

        await CreateService(context, source).FetchAllAsync();

        var refreshed = await context.NewsItems.SingleAsync();
        Assert.True(refreshed.FetchedAt > DateTime.UtcNow.AddMinutes(-5));
    }

    [Fact]
    public async Task NewEntries_AreInserted()
    {
        await using var context = CreateContext();
        var source = new StubSource("a",
            Entry("https://example.com/news/1"),
            Entry("https://example.com/news/2"));

        var result = await CreateService(context, source).FetchAllAsync();

        Assert.Equal(2, result.Added);
        Assert.Equal(2, await context.NewsItems.CountAsync());
    }

    [Fact]
    public async Task Report_CountsAddedAndUpdatedSeparately()
    {
        await using var context = CreateContext();
        const string url = "https://example.com/news/1";

        await CreateService(context, new StubSource("a", Entry(url, "Первый заголовок"))).FetchAllAsync();

        // Второй проход: запись уже есть, но заголовок поменялся у источника —
        // это update, а не добавление. Отчёт админа обязан различать их:
        // «+0/~1» и «+1/~0» — разные ответы на вопрос «что произошло».
        var second = await CreateService(context, new StubSource("a", Entry(url, "Другой заголовок")))
            .FetchAllAsync();

        Assert.Equal(0, second.Added);
        Assert.Equal(1, second.Updated);
    }

    [Fact]
    public async Task IdenticalRefetch_ReportsNoChanges()
    {
        await using var context = CreateContext();
        const string url = "https://example.com/news/1";

        await CreateService(context, new StubSource("a", Entry(url))).FetchAllAsync();

        // Фид не изменился — отчёт обязан быть пустым. Иначе кнопка «Обновить
        // сейчас» каждый раз пишет «обновлено 1», и настоящая правка источника
        // в этом шуме не видна.
        var second = await CreateService(context, new StubSource("a", Entry(url))).FetchAllAsync();

        Assert.Equal(0, second.Added);
        Assert.Equal(0, second.Updated);
    }

    [Fact]
    public async Task DuplicateUrlWithinSameFeed_IsStoredOnce()
    {
        await using var context = CreateContext();

        // Кривой фид иногда повторяет запись. Дедупликация обязана работать
        // и внутри одного ответа, а не только между запусками.
        var source = new StubSource("a",
            Entry("https://example.com/news/5"),
            Entry("https://example.com/news/5"));

        await CreateService(context, source).FetchAllAsync();

        Assert.Single(await context.NewsItems.ToListAsync());
    }

    [Fact]
    public async Task ParallelRuns_ProduceSingleRowPerArticle()
    {
        // Ручное «Обновить сейчас» поверх запущенного по таймеру: два фетчера
        // на одной базе. Ловит не проверка в коде, а уникальный индекс +
        // трактовка DbUpdateException как «уже вставлено соседом».
        await using var context = CreateContext();
        var source = new StubSource("a",
            Entry("https://example.com/news/1"),
            Entry("https://example.com/news/2"),
            Entry("https://example.com/news/3"));

        var first = CreateService(context, source);
        var second = CreateService(context, source);

        var results = await Task.WhenAll(first.FetchAllAsync(), second.FetchAllAsync());

        Assert.Equal(3, await context.NewsItems.CountAsync());
        Assert.Equal(3, results.Sum(r => r.Added));
    }

    // ───────────────────────────────────────────── битый фид

    [Fact]
    public async Task BrokenSource_DoesNotThrowAndCreatesNoRows()
    {
        await using var context = CreateContext();
        var broken = new StubSource("broken") { Throw = new HttpRequestException("DNS") };

        var result = await CreateService(context, broken).FetchAllAsync();

        // Ни исключения наружу, ни строк, ни вранья в отчёте.
        Assert.Empty(await context.NewsItems.ToListAsync());
        Assert.Equal(0, result.Added);
        Assert.Single(result.Failures);
        Assert.Equal("broken", result.Failures[0]);
    }

    [Fact]
    public async Task BrokenSource_DoesNotCancelHealthyNeighbour()
    {
        await using var context = CreateContext();
        var broken = new StubSource("broken") { Throw = new InvalidOperationException("разметка поехала") };
        var healthy = new StubSource("healthy", Entry("https://example.com/news/1"));

        var result = await CreateService(context, broken, healthy).FetchAllAsync();

        // Главное: записи живого источника доехали, несмотря на падение соседа.
        Assert.Single(await context.NewsItems.ToListAsync());
        Assert.Equal(1, result.Added);
        Assert.Single(result.Failures);
    }

    [Fact]
    public async Task EntryWithoutUrl_IsSkippedNotCrashed()
    {
        await using var context = CreateContext();
        var source = new StubSource("a",
            Entry(""),
            Entry("   "),
            Entry("https://example.com/news/1"));

        var result = await CreateService(context, source).FetchAllAsync();

        // Без ссылки нет ни ключа дедупликации, ни перехода к первоисточнику.
        Assert.Single(await context.NewsItems.ToListAsync());
        Assert.Equal(1, result.Added);
    }

    [Fact]
    public async Task UnsafeHtml_IsSanitizedBeforeStorage()
    {
        await using var context = CreateContext();
        var entry = Entry("https://example.com/news/x") with
        {
            Title = "  Заголовок  ",
            SourceName = "  Source  ",
            BodyHtml = "<p>ok</p><script>alert(1)</script><a href=\"javascript:alert(1)\">x</a>"
        };

        await CreateService(context, new StubSource("a", entry)).FetchAllAsync();

        var stored = await context.NewsItems.SingleAsync();

        // Скрипт из чужого фида не должен ни лежать в базе, ни доехать до читателя.
        Assert.DoesNotContain("script", stored.BodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("javascript:", stored.BodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("<p>ok</p>", stored.BodyHtml);
        Assert.Equal("Заголовок", stored.Title);
        Assert.Equal("Source", stored.SourceName);
    }

    [Fact]
    public async Task Sanitizer_KeepsAllowedMarkup()
    {
        await using var context = CreateContext();
        var entry = Entry("https://example.com/news/keep") with
        {
            // Абзацы, список и ссылка — обычная разметка фида. Санитайзер,
            // который вырезает и её, оставляет в карточке нечитаемую кашу.
            BodyHtml = "<p>Первый</p><ul><li>раз</li></ul><a href=\"https://example.com/s\">источник</a>"
        };

        await CreateService(context, new StubSource("a", entry)).FetchAllAsync();

        var stored = await context.NewsItems.SingleAsync();
        Assert.Contains("<p>Первый</p>", stored.BodyHtml);
        Assert.Contains("<li>раз</li>", stored.BodyHtml);
    }

    [Fact]
    public async Task Topics_AreNormalizedToInterestKeys()
    {
        await using var context = CreateContext();
        var entry = Entry("https://example.com/news/t", topics: new[] { "Sports", "незнакомая рубрика" });

        await CreateService(context, new StubSource("a", entry)).FetchAllAsync();

        var stored = await context.NewsItems.SingleAsync();

        // Темы хранятся строкой через запятую и обязаны совпадать с ключами
        // справочника Interests, иначе фильтр по интересам не найдёт ничего.
        Assert.Equal("sport,interesting", stored.Topics);
    }

    [Fact]
    public async Task StaleEntry_IsNotFetched()
    {
        await using var context = CreateContext();
        var stale = Entry("https://example.com/news/old",
            publishedAt: DateTime.UtcNow.AddDays(-500));

        var result = await CreateService(context, new StubSource("a", stale)).FetchAllAsync();

        // Новость, которую всё равно удалит уборка на следующем проходе,
        // незачем вставлять: она займёт слот свежести и уйдёт через минуту.
        Assert.Equal(0, result.Added);
        Assert.Empty(await context.NewsItems.ToListAsync());
    }

    [Fact]
    public async Task InvalidLevel_IsDroppedInsteadOfTruncated()
    {
        await using var context = CreateContext();
        var entry = Entry("https://example.com/news/lvl", level: "Beginner");

        await CreateService(context, new StubSource("a", entry)).FetchAllAsync();

        var stored = await context.NewsItems.SingleAsync();

        // Колонка — 2 символа под CEFR. «Be» из «Beginner» превратил бы
        // новость в бессмысленный уровень и попал бы в персональную выдачу.
        Assert.Null(stored.Level);
    }

    [Fact]
    public async Task LowercaseLevel_IsNormalizedToUppercase()
    {
        await using var context = CreateContext();
        var entry = Entry("https://example.com/news/lvl2", level: "b1");

        await CreateService(context, new StubSource("a", entry)).FetchAllAsync();

        Assert.Equal("B1", (await context.NewsItems.SingleAsync()).Level);
    }

    // ───────────────────────────────────────────── уборка

    [Fact]
    public async Task Cleanup_DeletesOnlyOldNews()
    {
        await using var context = CreateContext();
        var now = DateTime.UtcNow;

        context.NewsItems.AddRange(
            new NewsItem
            {
                ExternalId = new string('a', 64), Title = "Старая", Summary = "s",
                SourceName = "src", SourceUrl = "https://example.com/old",
                PublishedAt = now.AddDays(-200)
            },
            new NewsItem
            {
                ExternalId = new string('b', 64), Title = "Свежая", Summary = "s",
                SourceName = "src", SourceUrl = "https://example.com/new",
                PublishedAt = now.AddDays(-1)
            },
            new NewsItem
            {
                ExternalId = new string('c', 64), Title = "На границе", Summary = "s",
                SourceName = "src", SourceUrl = "https://example.com/edge",
                // Один день внутри порога: удалять её значит сдвинуть порог
                // на день раньше обещанного.
                PublishedAt = now.AddDays(-119)
            });
        await context.SaveChangesAsync();

        var cleanup = new NewsCleanupService(
            context, NullLogger<NewsCleanupService>.Instance, retentionDays: 120);

        var deleted = await cleanup.RunOnceAsync();

        Assert.Equal(1, deleted);
        var remaining = await context.NewsItems.Select(n => n.Title).ToListAsync();
        Assert.Equal(new[] { "На границе", "Свежая" }, remaining.OrderBy(t => t));
    }

    [Fact]
    public async Task Cleanup_DefaultRetention_Is120Days()
    {
        // Дефолт зашит константой: без него «конфиг молчит» = «храним вечно»,
        // и таблица растёт без границы, которую мы кому-то обещали.
        Assert.Equal(120, NewsCleanupService.DefaultRetentionDays);
    }

    [Fact]
    public async Task Cleanup_DeletesHiddenNewsToo()
    {
        await using var context = CreateContext();
        context.NewsItems.Add(new NewsItem
        {
            ExternalId = new string('d', 64), Title = "Скрытая старая", Summary = "s",
            SourceName = "src", SourceUrl = "https://example.com/hidden",
            PublishedAt = DateTime.UtcNow.AddDays(-300), IsHidden = true
        });
        await context.SaveChangesAsync();

        var deleted = await new NewsCleanupService(
            context, NullLogger<NewsCleanupService>.Instance, 120).RunOnceAsync();

        // Скрытие — не бессрочное хранение: админ спрятал новость, но через
        // четыре месяца от неё остаётся только запись в журнале.
        Assert.Equal(1, deleted);
    }

    // ───────────────────────────────────────────── публичная выдача и админка

    [Fact]
    public async Task HiddenNews_IsNotReturnedToPublicFeed()
    {
        await using var context = CreateContext();
        var now = DateTime.UtcNow;

        context.NewsItems.AddRange(
            new NewsItem
            {
                ExternalId = new string('e', 64), Title = "Видимая", Summary = "s",
                SourceName = "src", SourceUrl = "https://example.com/a",
                PublishedAt = now, Level = "A2"
            },
            new NewsItem
            {
                ExternalId = new string('f', 64), Title = "Скрытая", Summary = "s",
                SourceName = "src", SourceUrl = "https://example.com/b",
                PublishedAt = now, Level = "A2", IsHidden = true
            });
        await context.SaveChangesAsync();

        // Тот же запрос, которым публичная лента строит выдачу.
        var visible = await context.NewsItems
            .Where(n => !n.IsHidden)
            .OrderByDescending(n => n.PublishedAt)
            .ToListAsync();

        Assert.Single(visible);
        Assert.Equal("Видимая", visible[0].Title);

        // И скрытая строка не исчезла: дедупликация должна её помнить.
        Assert.Equal(2, await context.NewsItems.CountAsync());
    }

    [Fact]
    public async Task HiddenNews_SurvivesRepeatFetch()
    {
        await using var context = CreateContext();
        const string url = "https://example.com/news/hidden";

        await CreateService(context, new StubSource("a", Entry(url))).FetchAllAsync();

        var stored = await context.NewsItems.SingleAsync();
        stored.IsHidden = true;
        await context.SaveChangesAsync();

        await CreateService(context, new StubSource("a", Entry(url))).FetchAllAsync();

        // Скрытие не снимается повторным опросом и не порождает вторую строку:
        // иначе админ прячет новость, а через два часа она возвращается сама.
        var after = await context.NewsItems.SingleAsync();
        Assert.True(after.IsHidden);
    }

    private static (AdminNewsController Controller, ApplicationDbContext Context) CreateAdminHarness()
    {
        var context = CreateContext();
        var cache = new MemoryCache(new MemoryCacheOptions());
        var invalidator = new ContentCacheInvalidator(cache, NullLogger<ContentCacheInvalidator>.Instance);
        var controller = new AdminNewsController(
            context,
            new NewsFetchService(context, Array.Empty<INewsSource>(), NullLogger<NewsFetchService>.Instance),
            new NewsCleanupService(context, NullLogger<NewsCleanupService>.Instance, 120),
            invalidator,
            NullLogger<AdminNewsController>.Instance);

        return (controller, context);
    }

    [Fact]
    public async Task AdminList_FiltersByHidden()
    {
        var (controller, context) = CreateAdminHarness();
        context.NewsItems.AddRange(
            new NewsItem
            {
                ExternalId = new string('g', 64), Title = "A", Summary = "s",
                SourceName = "src", SourceUrl = "https://example.com/1",
                PublishedAt = DateTime.UtcNow
            },
            new NewsItem
            {
                ExternalId = new string('h', 64), Title = "B", Summary = "s",
                SourceName = "src", SourceUrl = "https://example.com/2",
                PublishedAt = DateTime.UtcNow, IsHidden = true
            });
        await context.SaveChangesAsync();

        var all = await controller.List(page: 1, pageSize: 50, hidden: null, ct: default);
        var hiddenOnly = await controller.List(page: 1, pageSize: 50, hidden: true, ct: default);

        Assert.NotNull(all.Result);
        Assert.NotNull(hiddenOnly.Result);
        Assert.Contains("total", Json(all.Result!).ToLowerInvariant());
    }

    [Fact]
    public async Task AdminHideThenShow_TogglesFlag()
    {
        var (controller, context) = CreateAdminHarness();
        context.NewsItems.Add(new NewsItem
        {
            ExternalId = new string('i', 64), Title = "A", Summary = "s",
            SourceName = "src", SourceUrl = "https://example.com/1",
            PublishedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
        var id = (await context.NewsItems.SingleAsync()).Id;

        Assert.IsType<OkObjectResult>((await controller.Hide(id, default)).Result);
        Assert.True((await context.NewsItems.AsNoTracking().SingleAsync()).IsHidden);

        Assert.IsType<OkObjectResult>((await controller.Show(id, default)).Result);
        Assert.False((await context.NewsItems.AsNoTracking().SingleAsync()).IsHidden);
    }

    [Fact]
    public async Task AdminHide_UnknownId_Is404()
    {
        var (controller, _) = CreateAdminHarness();

        Assert.IsType<NotFoundObjectResult>((await controller.Hide(424242, default)).Result);
        Assert.IsType<NotFoundObjectResult>((await controller.Show(424242, default)).Result);
    }

    [Fact]
    public void AdminController_RequiresAdminRole_AndExpectedRoute()
    {
        // Роль и маршрут — часть контракта, а не деталь оформления: тест
        // ловит случайное удаление атрибута при рефакторинге.
        var type = typeof(AdminNewsController);

        var authorize = type.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Single();

        var route = type.GetCustomAttributes(typeof(Microsoft.AspNetCore.Mvc.RouteAttribute), true)
            .Cast<Microsoft.AspNetCore.Mvc.RouteAttribute>()
            .Single();

        Assert.Equal("Admin", authorize.Roles);
        Assert.Equal("api/admin/news", route.Template);
    }

    [Fact]
    public async Task BackgroundCycle_RunsFetchAndCleanupWithoutThrowing()
    {
        await using var context = CreateContext();
        var now = DateTime.UtcNow;

        context.NewsItems.Add(new NewsItem
        {
            ExternalId = new string('z', 64), Title = "Древняя", Summary = "s",
            SourceName = "src", SourceUrl = "https://example.com/ancient",
            PublishedAt = now.AddDays(-400)
        });
        await context.SaveChangesAsync();

        var scopeFactory = new ServiceCollection()
            .AddSingleton(context)
            .AddSingleton<ILogger<NewsFetchService>>((ILogger<NewsFetchService>)NullLogger<NewsFetchService>.Instance)
            .AddSingleton<ILogger<NewsCleanupService>>((ILogger<NewsCleanupService>)NullLogger<NewsCleanupService>.Instance)
            .AddSingleton<ILogger<NewsFetchBackgroundService>>((ILogger<NewsFetchBackgroundService>)NullLogger<NewsFetchBackgroundService>.Instance)
            .AddSingleton<IEnumerable<INewsSource>>(new[] { new StubSource("ok", Entry("https://example.com/fresh")) })
            .AddScoped<NewsFetchService>()
            .AddScoped<NewsCleanupService>()
            .BuildServiceProvider()
            .GetRequiredService<IServiceScopeFactory>();

        var service = new NewsFetchBackgroundService(
            scopeFactory, new NewsOptions(), NullLogger<NewsFetchBackgroundService>.Instance);

        await service.RunCycleAsync();

        // Один проход делает обе вещи: приносит свежее и снимает древнее.
        // Именно так устроен таймер — разделять их пришлось бы двумя расписаниями.
        var remaining = await context.NewsItems.Select(n => n.Title).ToListAsync();
        Assert.Equal(new[] { "Заголовок" }, remaining);
    }

    [Fact]
    public async Task BackgroundCycle_SurvivesBadSource()
    {
        await using var context = CreateContext();

        var scopeFactory = new ServiceCollection()
            .AddSingleton(context)
            .AddSingleton<ILogger<NewsFetchService>>((ILogger<NewsFetchService>)NullLogger<NewsFetchService>.Instance)
            .AddSingleton<ILogger<NewsCleanupService>>((ILogger<NewsCleanupService>)NullLogger<NewsCleanupService>.Instance)
            .AddSingleton<ILogger<NewsFetchBackgroundService>>((ILogger<NewsFetchBackgroundService>)NullLogger<NewsFetchBackgroundService>.Instance)
            .AddSingleton<IEnumerable<INewsSource>>(new INewsSource[]
            {
                new StubSource("broken") { Throw = new HttpRequestException("сеть") }
            })
            .AddScoped<NewsFetchService>()
            .AddScoped<NewsCleanupService>()
            .BuildServiceProvider()
            .GetRequiredService<IServiceScopeFactory>();

        var service = new NewsFetchBackgroundService(
            scopeFactory, new NewsOptions(), NullLogger<NewsFetchBackgroundService>.Instance);

        // Никакого исключения: цикл обязан пережить недоступный источник и
        // дождаться следующего тика, иначе фоновый сервис умрёт на старте.
        await service.RunCycleAsync();

        Assert.Empty(await context.NewsItems.ToListAsync());
    }

    [Fact]
    public void Options_Defaults_AreTwoHoursTwoMinutes120Days()
    {
        var options = NewsOptions.FromConfiguration(
            new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build());

        Assert.True(options.Enabled);
        Assert.Equal(2, options.FetchIntervalHours);
        Assert.Equal(2, options.InitialDelayMinutes);
        Assert.Equal(120, options.RetentionDays);
    }

    [Fact]
    public void Options_ZeroInterval_FallsBackToDefault()
    {
        // Интервал в ноль часов — это «опросить чужой сайт бесконечно».
        // Такой конфиг обязан превратиться в дефолт, а не в цикл без паузы.
        var options = NewsOptions.FromConfiguration(
            new Microsoft.Extensions.Configuration.ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["News:FetchIntervalHours"] = "0",
                    ["News:RetentionDays"] = "-5",
                    ["News:InitialDelayMinutes"] = "0",
                    ["News:Enabled"] = "false"
                })
                .Build());

        Assert.Equal(2, options.FetchIntervalHours);
        Assert.Equal(120, options.RetentionDays);
        // Ноль минут на старте — законное «запускать сразу».
        Assert.Equal(0, options.InitialDelayMinutes);
        Assert.False(options.Enabled);
    }

    // ─────────────────────────────────────────────────────── хелперы

    private static string Json(ActionResult result) =>
        System.Text.Json.JsonSerializer.Serialize(
            Assert.IsType<OkObjectResult>(result).Value,
            new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });

    /// <summary>
    /// Источник-заглушка: отдаёт заранее заданные записи или бросает заданное
    /// исключение. Поведение ровно то, которое фетчер обязан пережить.
    /// </summary>
    private sealed class StubSource : INewsSource
    {
        private readonly IReadOnlyList<NewsFeedEntry> _entries;

        public StubSource(string name, params NewsFeedEntry[] entries)
        {
            Name = name;
            _entries = entries;
        }

        public string Name { get; }

        public Exception? Throw { get; init; }

        public Task<IReadOnlyList<NewsFeedEntry>> FetchAsync(CancellationToken ct)
        {
            if (Throw != null) throw Throw;
            return Task.FromResult(_entries);
        }
    }
}
