using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// W2.4 — гостевая воронка публичного /test: `POST /api/analytics/anonymous`.
///
/// Смысл эндпоинта в том, что он одновременно анонимный и закрытый: пустить
/// гостя можно, а пустой write-путь в аналитику — нельзя. Поэтому проверяется
/// не «работает ли счётчик», а ровно те границы, которые делают его безопасным:
/// whitelist событий, отсутствие поля для свободного текста, кап тела,
/// Content-Type, хеш вместо IP, идемпотентность повторной отправки и то, что
/// чтение воронки осталось за административным ключом.
/// </summary>
public class GuestAnalyticsTests
{
    private const string Salt = "unit-test-guest-salt";
    private const string IpA = "203.0.113.9";
    private const string IpB = "198.51.100.7";

    private static ApplicationDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static AnonymousAnalyticsController CreateController(
        ApplicationDbContext context,
        string ip = IpA,
        string? salt = Salt)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Analytics:GuestIpSalt"] = salt })
            .Build();

        return new AnonymousAnalyticsController(
            context,
            NullLogger<AnonymousAnalyticsController>.Instance,
            configuration)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    Connection = { RemoteIpAddress = IPAddress.Parse(ip) },
                    Request = { ContentType = "application/json" }
                }
            }
        };
    }

    /// <summary>Отправка как её увидит экшен: связанный JSON + заголовки запроса.</summary>
    private static async Task<IActionResult> Post(
        AnonymousAnalyticsController controller,
        string json,
        long? contentLength = null)
    {
        // Content-Length ставим как у живого запроса — на нём стоит кап тела.
        controller.Request.ContentLength = contentLength ?? Encoding.UTF8.GetByteCount(json);

        using var document = JsonDocument.Parse(json);
        return await controller.Track(document.RootElement, CancellationToken.None);
    }

    private static string Started(string dedupeKey) =>
        $$"""{"event":"placement_test_started","dedupeKey":"{{dedupeKey}}"}""";

    private static string Completed(string level, string dedupeKey) =>
        $$"""{"event":"placement_test_completed","level":"{{level}}","dedupeKey":"{{dedupeKey}}"}""";

    // ---- whitelist ----------------------------------------------------------

    [Fact]
    public void AllowedEvents_ContainExactlyWhatTestPageCanSend()
    {
        // Из трёх событий ТЗ живых два: placement_test_abandoned_step с /test
        // не отправляемо надёжно (причина — в комментарии контроллера), а
        // мёртвая строка в whitelist — это открытая дверь, которая ждёт автора.
        //
        // W3.4 добавила ровно две строки — просмотры серверных витрин, у которых
        // нет ни уровня, ни slug'а: список обязан remaining закрытым, и этот
        // тест падает при любом несанкционированном расширении контракта.
        Assert.Equal(
            new[]
            {
                "cohort_page_viewed",
                "library_page_viewed",
                "placement_test_completed",
                "placement_test_started",
            },
            AnonymousAnalyticsController.AllowedEvents.OrderBy(e => e, StringComparer.Ordinal));
    }

    [Fact]
    public void ViewedEvents_AreNamedConstantsAndCarryNoSurfaceData()
    {
        // Имена зафиксированы константами (как и события теста), потому что к
        // ним привязана выгрузка /acquisition: сравнение строк в отчёте и
        // опечатка в ней = молча нулевая колонка.
        Assert.Equal("cohort_page_viewed", AnonymousAnalyticsController.CohortViewedEvent);
        Assert.Equal("library_page_viewed", AnonymousAnalyticsController.LibraryViewedEvent);

        // Ни slug книги, ни query, ни user-agent: ни одного поля под них в
        // контракте нет, и появление такого поля — это снова свободный текст.
        var allowedFields = (HashSet<string>)typeof(AnonymousAnalyticsController)
            .GetField("AllowedFields", BindingFlags.NonPublic | BindingFlags.Static)!
            .GetValue(null)!;

        Assert.Equal(
            new[] { "dedupeKey", "event", "level" },
            allowedFields.OrderBy(f => f, StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public void GuestAndAuthenticatedWhitelists_DoNotIntersect()
    {
        // Гостевые и «читательские» события — разные таблицы и разные контуры
        // доступа. Пересечение имён означало бы, что один путь может писать
        // метрики другого, и воронка перестала бы отвечать на свой вопрос.
        Assert.Empty(AnonymousAnalyticsController.AllowedEvents.Intersect(AnalyticsController.AllowedEvents));
    }

    [Fact]
    public async Task UnknownEvent_IsRejectedAndNothingIsWritten()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        var result = await Post(controller, """{"event":"placement_test_v2","dedupeKey":"aaaaaaaa"}""");

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, await context.GuestAnalyticsEvents.CountAsync());
    }

    [Fact]
    public async Task AuthenticatedOnlyEvent_CannotBeSentByGuest()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // chapter_opened_first — метрика активации читателя. Гость, который
        // умеет её писать, рисовал бы себе активации сам.
        var result = await Post(controller,
            """{"event":"chapter_opened_first","dedupeKey":"bbbbbbbb"}""");

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, await context.GuestAnalyticsEvents.CountAsync());
    }

    // ---- тело запроса: никакого свободного текста ---------------------------

    [Fact]
    public async Task FreeTextField_IsRejectedEvenWhenEventIsValid()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // «meta» — поле аутентифицированного эндпоинта: до 500 символов чего
        // угодно. На гостевом пути такому полю негде быть: спам в счётчиках и
        // чужие тексты в нашей базе — ровно та причина, по которой путь
        // не открыли целиком.
        var result = await Post(controller,
            $$"""{"event":"placement_test_started","dedupeKey":"cccccccc","meta":"{{new string('ы', 90)}}"}""");

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, await context.GuestAnalyticsEvents.CountAsync());
    }

    [Fact]
    public async Task UnknownNestedField_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        var result = await Post(controller,
            """{"event":"placement_test_started","dedupeKey":"dddddddd","data":{"long":"x"}}""");

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task NonStringFieldValue_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        var result = await Post(controller, """{"event":"placement_test_started","dedupeKey":12345678}""");

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task FieldLongerThanContract_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // Известное поле, но неограниченная строка в нём: длина проверяется
        // до того, как значение вообще куда-то попадает.
        var result = await Post(controller, Completed(new string('a', 200), "eeeeeeee"));

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, await context.GuestAnalyticsEvents.CountAsync());
    }

    [Fact]
    public async Task BodyAboveSizeCap_IsRejectedWith413()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        var result = await Post(controller, Started("ffffffff"),
            contentLength: AnonymousAnalyticsController.MaxBodyBytes + 1);

        Assert.Equal(StatusCodes.Status413RequestEntityTooLarge,
            Assert.IsType<ObjectResult>(result).StatusCode);
        Assert.Equal(0, await context.GuestAnalyticsEvents.CountAsync());
    }

    [Fact]
    public async Task NonJsonContentType_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context);
        controller.Request.ContentType = "text/plain";

        var result = await Post(controller, Started("gggggggg"));

        Assert.Equal(StatusCodes.Status415UnsupportedMediaType,
            Assert.IsType<ObjectResult>(result).StatusCode);
        Assert.Equal(0, await context.GuestAnalyticsEvents.CountAsync());
    }

    [Fact]
    public async Task JsonArrayInsteadOfObject_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        Assert.IsType<BadRequestObjectResult>(await Post(controller, """["placement_test_started"]"""));
    }

    [Fact]
    public async Task MissingDedupeKey_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        Assert.IsType<BadRequestObjectResult>(
            await Post(controller, """{"event":"placement_test_started"}"""));
        Assert.Equal(0, await context.GuestAnalyticsEvents.CountAsync());
    }

    // ---- уровень ------------------------------------------------------------

    [Fact]
    public async Task Completed_WithoutLevel_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        Assert.IsType<BadRequestObjectResult>(
            await Post(controller, """{"event":"placement_test_completed","dedupeKey":"hhhhhhhh"}"""));
    }

    [Fact]
    public async Task Completed_WithLevelOutsideCefrScale_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // Уровень — единственное значение, которое гость сообщает о себе, и он
        // обязан быть кодом шкалы: иначе поле снова стало свободным текстом.
        foreach (var level in new[] { "z9", "A+", "native", "a2; drop table", "" })
        {
            Assert.IsType<BadRequestObjectResult>(await Post(controller, Completed(level, "iiiiiiii")));
        }

        Assert.Equal(0, await context.GuestAnalyticsEvents.CountAsync());
    }

    [Fact]
    public async Task Started_WithLevel_IsRejectedAsBrokenClient()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        var result = await Post(controller,
            """{"event":"placement_test_started","level":"b1","dedupeKey":"jjjjjjjj"}""");

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Theory]
    [InlineData("a1")]
    [InlineData("a2")]
    [InlineData("b1")]
    [InlineData("b2")]
    [InlineData("c1")]
    public async Task Completed_AcceptsEveryLevelTheServerCanReturn(string level)
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // Совпадение со шкалой ProfileController.SubmitPlacementResult — иначе
        // реальный результат гостя молча отбрасывался бы и воронка недосчитывала.
        Assert.IsType<OkResult>(await Post(controller, Completed(level, $"dedupe-{level}")));
        Assert.Equal(level, Assert.Single(await context.GuestAnalyticsEvents.ToListAsync()).Level);
    }

    // ---- запись: что реально лежит -----------------------------------------

    [Fact]
    public async Task ValidSend_WritesHourDayAndIpHashButNeverTheIp()
    {
        using var context = CreateContext();
        var controller = CreateController(context, ip: IpA);

        Assert.IsType<OkResult>(await Post(controller, Completed("b1", "kkkkkkkk")));

        var row = Assert.Single(await context.GuestAnalyticsEvents.ToListAsync());
        Assert.Equal("placement_test_completed", row.Event);
        Assert.Equal("b1", row.Level);
        Assert.Equal(DateOnly.FromDateTime(DateTime.UtcNow), row.Day);
        Assert.InRange(row.Hour, 0, 23);

        // Ни IP, ни что-то на него похожее в записи не помещается.
        Assert.DoesNotContain(IpA, row.IpHash, StringComparison.Ordinal);
        Assert.Matches("^[0-9a-f]{64}$", row.IpHash);
    }

    [Fact]
    public async Task Started_WritesWithoutLevel()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        Assert.IsType<OkResult>(await Post(controller, Started("llllllll")));
        Assert.Null(Assert.Single(await context.GuestAnalyticsEvents.ToListAsync()).Level);
    }

    [Fact]
    public async Task SameDedupeKey_Twice_IsStoredOnceAndBothRepliesAreOk()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // Сетевой повтор после обрыва и перемонтировавшийся эффект — одно
        // событие, а не два гостя. Ответ оба раза 200: аналитика не должна
        // подсказывать клиенту, что что-то пошло не так (тот же принцип, что у
        // chapter_opened_first).
        Assert.IsType<OkResult>(await Post(controller, Completed("a2", "mmmmmmmm")));
        Assert.IsType<OkResult>(await Post(controller, Completed("a2", "mmmmmmmm")));

        Assert.Single(await context.GuestAnalyticsEvents.ToListAsync());
    }

    [Fact]
    public async Task SecondPassOfTheSameGuest_IsStoredSeparately()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // Мерим проходы теста: человек, прошедший дважды за один заход, — это
        // два прохода, и новый nonce обязан дать новую строку.
        Assert.IsType<OkResult>(await Post(controller, Completed("c1", "nnnnnnnn")));
        Assert.IsType<OkResult>(await Post(controller, Completed("c1", "oooooooo")));

        Assert.Equal(2, await context.GuestAnalyticsEvents.CountAsync());
    }

    [Fact]
    public async Task StorageFailure_StillReturnsOk()
    {
        // Гостевой тест не должен падать из-за счётчика: упавшая база
        // превращается в молчаливую потерю метрики, а не в 500 на /test.
        using var context = CreateContext();
        var controller = CreateController(context);
        await context.DisposeAsync();

        Assert.IsType<OkResult>(await Post(controller, Started("pppppppp")));
    }

    // ---- W3.4: просмотры серверных витрин ----------------------------------

    [Theory]
    [InlineData("cohort_page_viewed")]
    [InlineData("library_page_viewed")]
    public async Task PageViewEvent_IsAcceptedAndWrittenWithoutLevel(string eventName)
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        var result = await Post(controller, $$"""{"event":"{{eventName}}","dedupeKey":"pv-aaaaaaaa"}""");

        Assert.IsType<OkResult>(result);

        var row = Assert.Single(await context.GuestAnalyticsEvents.ToListAsync());
        Assert.Equal(eventName, row.Event);

        // Ни уровня, ни чего-либо ещё: у просмотра страницы нет значения,
        // кроме факта просмотра.
        Assert.Null(row.Level);
        Assert.Equal("pv-aaaaaaaa", row.DedupeKey);
        Assert.Matches("^[0-9a-f]{64}$", row.IpHash);
    }

    [Fact]
    public async Task PageViewEvent_IsCaseInsensitiveLikeTheRestOfTheWhitelist()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        Assert.IsType<OkResult>(await Post(controller,
            """{"event":"Cohort_Page_Viewed","dedupeKey":"pv-bbbbbbbb"}"""));

        // Приведение к нижнему регистру одно на все события: иначе два написания
        // одного имени стали бы двумя счётчиками в выгрузке.
        Assert.Equal("cohort_page_viewed",
            Assert.Single(await context.GuestAnalyticsEvents.ToListAsync()).Event);
    }

    [Fact]
    public async Task CohortPageView_WithLevel_IsRejected()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // Уровень бывает только у завершения теста (проверка общая, но именно
        // здесь она впервые реально проверяется на новом имени): клиент,
        // решивший «заодно» прислать уровень просмотра, получает 400, а не
        // строку с уровнем в таблице.
        var result = await Post(controller,
            """{"event":"cohort_page_viewed","level":"b1","dedupeKey":"pv-cccccccc"}""");

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, await context.GuestAnalyticsEvents.CountAsync());
    }

    [Theory]
    [InlineData("slug")]
    [InlineData("path")]
    [InlineData("url")]
    [InlineData("userAgent")]
    [InlineData("referrer")]
    [InlineData("meta")]
    [InlineData("query")]
    public async Task PageViewEvent_WithAnyUnknownKey_IsRejected(string field)
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // Защита от тихого расширения контракта: новое поле = свободный текст в
        // анонимной таблице, поэтому ответ — 400, а не «молча выбросили».
        var result = await Post(controller,
            $$"""{"event":"library_page_viewed","dedupeKey":"pv-dddddddd","{{field}}":"a1"}""");

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, await context.GuestAnalyticsEvents.CountAsync());
    }

    [Fact]
    public async Task PageView_SameDedupeKeyTwice_IsStoredOnce()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // Двойной эффект в клиентском компоненте и сетевой ретрай — один
        // просмотр, а не два: иначе только что заведённый счётчик завышался бы
        // ровно на баг в нашем же коде.
        var body = """{"event":"cohort_page_viewed","dedupeKey":"pv-eeeeeeee"}""";

        Assert.IsType<OkResult>(await Post(controller, body));
        Assert.IsType<OkResult>(await Post(controller, body));

        Assert.Single(await context.GuestAnalyticsEvents.ToListAsync());
    }

    [Fact]
    public async Task PageView_TwoDifferentPages_AreTwoRowsWithOneNonceEach()
    {
        using var context = CreateContext();
        var controller = CreateController(context);

        // Ключ антидубля — (событие, nonce): один и тот же nonce на два разных
        // события не должен съесть второй просмотр.
        Assert.IsType<OkResult>(await Post(controller,
            """{"event":"cohort_page_viewed","dedupeKey":"pv-shared"}"""));
        Assert.IsType<OkResult>(await Post(controller,
            """{"event":"library_page_viewed","dedupeKey":"pv-shared"}"""));

        Assert.Equal(2, await context.GuestAnalyticsEvents.CountAsync());
    }

    // ---- IpHash -------------------------------------------------------------

    [Fact]
    public void IpHash_IsOneWayHexAndNotTheIp()
    {
        var hash = GuestIdentity.IpHash(Salt, DateOnly.FromDateTime(DateTime.UtcNow), IpA);

        Assert.Equal(64, hash.Length);
        Assert.Matches("^[0-9a-f]{64}$", hash);
        Assert.DoesNotContain(IpA, hash, StringComparison.Ordinal);
    }

    [Fact]
    public void IpHash_ChangesOnTheNextDay()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var tomorrow = today.AddDays(1);

        // Соль суточная: вчерашнюю запись сегодня уже нельзя сопоставить с
        // сегодняшней, то есть между сессиями гостя не преследуем.
        Assert.NotEqual(
            GuestIdentity.IpHash(Salt, today, IpA),
            GuestIdentity.IpHash(Salt, tomorrow, IpA));
    }

    [Fact]
    public void IpHash_IsStableWithinTheSameDayAndSplitsDifferentIps()
    {
        var day = DateOnly.FromDateTime(DateTime.UtcNow);

        Assert.Equal(GuestIdentity.IpHash(Salt, day, IpA), GuestIdentity.IpHash(Salt, day, IpA));
        Assert.NotEqual(GuestIdentity.IpHash(Salt, day, IpA), GuestIdentity.IpHash(Salt, day, IpB));
    }

    [Fact]
    public void IpHash_WithoutConfiguredSalt_FallsBackToPerProcessKey()
    {
        // Не задан ключ — не значит «не солится». Фолбэк обязан быть случайным:
        // sha256 от IP без соли подбирается по любому списку адресов за секунды.
        var fallback = GuestIdentity.ResolveSalt(null);

        Assert.False(string.IsNullOrWhiteSpace(fallback));
        Assert.NotEqual(GuestIdentity.ResolveSalt("another-secret"), fallback);
        Assert.NotEqual(
            GuestIdentity.IpHash(fallback, DateOnly.FromDateTime(DateTime.UtcNow), IpA),
            GuestIdentity.IpHash(Salt, DateOnly.FromDateTime(DateTime.UtcNow), IpA));
    }

    [Fact]
    public void DailySaltKey_StableForSameDayAndChangesWithDate()
    {
        var day = DateOnly.FromDateTime(DateTime.UtcNow);

        Assert.Equal(GuestIdentity.DailySaltKey(Salt, day), GuestIdentity.DailySaltKey(Salt, day));
        Assert.NotEqual(GuestIdentity.DailySaltKey(Salt, day), GuestIdentity.DailySaltKey(Salt, day.AddDays(1)));
        Assert.DoesNotContain(day.ToString("yyyy-MM-dd"), GuestIdentity.DailySaltKey(Salt, day), StringComparison.Ordinal);
    }

    // ---- лимитер, маршрут и отсутствие читалки ------------------------------

    [Fact]
    public void GuestPath_HasItsOwnRateLimitPolicyPartitionedByIp()
    {
        Assert.True(RateLimitPolicies.EndpointPartitions.TryGetValue("guest-analytics", out var partition));
        Assert.NotNull(partition);

        // Партиция по IP: разные гости не делят одну корзину (и, как везде по IP,
        // расходятся только когда Proxy__TrustedCidrs настроен — см. DEPLOY.md).
        Assert.NotEqual(
            partition!(RateLimitProbeContext(IpA)).PartitionKey,
            partition(RateLimitProbeContext(IpB)).PartitionKey);

        // Лимитер существует под этим именем: опечатка в EnableRateLimiting
        // обрушила бы эндпоинт в рантайме, а не на этапе сборки.
        using var limiter = PartitionedRateLimiter.Create<HttpContext, string>(
            RateLimitPolicies.EndpointPartitions["guest-analytics"]);

        // Считаем реальное поведение, а не константу: гостевой write-путь обязан
        // останавливать поток именно на заявленном бюджете.
        var context = RateLimitProbeContext(IpA);
        var acquired = 0;
        for (var i = 0; i < RateLimitPolicies.GuestAnalyticsPermitLimit + 5; i++)
        {
            using var lease = limiter.AttemptAcquire(context);
            if (lease.IsAcquired)
            {
                acquired++;
            }
        }

        Assert.Equal(RateLimitPolicies.GuestAnalyticsPermitLimit, acquired);

        // Соседний IP не наследует чужой переполненный бюджет.
        using var otherLease = limiter.AttemptAcquire(RateLimitProbeContext(IpB));
        Assert.True(otherLease.IsAcquired);

        // Бюджет гостя заметно теснее аутентифицированной аналитики: анонимный
        // путь не должен позволять скрипту лить строки быстрее, чем их режет лимит.
        Assert.True(
            RateLimitPolicies.GuestAnalyticsPermitLimit < RateLimitPolicies.AnalyticsPermitLimit,
            "гостевой лимит обязан быть теснее читательского");
    }

    private static HttpContext RateLimitProbeContext(string ip) => new DefaultHttpContext
    {
        Connection = { RemoteIpAddress = IPAddress.Parse(ip) },
        Request = { Method = HttpMethods.Post, Path = "/api/analytics/anonymous" }
    };

    [Fact]
    public void AnonymousController_UsesTheDocumentedRouteAndIsAllowAnonymous()
    {
        var type = typeof(AnonymousAnalyticsController);

        Assert.NotNull(type.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Null(type.GetCustomAttribute<AuthorizeAttribute>());
        Assert.Equal("api/analytics", type.GetCustomAttribute<RouteAttribute>()!.Template);

        var action = type.GetMethod("Track")!;
        Assert.Equal("anonymous", action.GetCustomAttribute<HttpPostAttribute>()!.Template);
        Assert.Equal("guest-analytics",
            action.GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
    }

    [Fact]
    public void AuthenticatedAnalyticsController_IsStillClosedByClassAuthorize()
    {
        // Гостевой путь сделан отдельным именно поэтому: старый контроллер
        // обязан остаться за JWT.
        Assert.NotNull(typeof(AnalyticsController).GetCustomAttribute<AuthorizeAttribute>());
    }

    [Fact]
    public void AnonymousController_ExposesNoReadEndpoint()
    {
        // Гостевой путь пишет и только. Появится GET — он обязан получить
        // админский ключ, иначе любой сможет вычитать чужую воронку.
        var readActions = typeof(AnonymousAnalyticsController)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes().Any(a =>
                a is HttpGetAttribute or HttpHeadAttribute or HttpOptionsAttribute))
            .ToArray();

        Assert.Empty(readActions);
    }

    [Fact]
    public async Task AcquisitionEndpoint_StillRequiresAdminKey()
    {
        using var context = CreateContext();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Seeder:Key"] = "admin-secret" })
            .Build();
        var controller = new AnalyticsController(
            context,
            NullLogger<AnalyticsController>.Instance,
            configuration,
            new TestWebHostEnvironment { EnvironmentName = "Production" });

        // Расширение выгрузки гостевыми колонками не должно было тронуть контур
        // доступа: без ключа — 401, даже на пустой воронке.
        Assert.IsType<UnauthorizedObjectResult>(await controller.Acquisition(null));
        Assert.IsType<UnauthorizedObjectResult>(await controller.Acquisition("wrong-key"));
        Assert.IsType<OkObjectResult>(await controller.Acquisition("admin-secret"));
    }
}
