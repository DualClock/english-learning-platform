using System.Reflection;
using System.Text.Json;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Guest;
using EnglishLearningPlatform.API.Services.Reader;
using EnglishLearningPlatform.API.Tests.Reader;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Guest;

/// <summary>
/// R2 — гостевое чтение: каталог без владельца, ровно первая глава, перевод из
/// WordLevels и НИ ОДНОЙ записи от имени гостя.
///
/// Проверяется не «вернулся 200», а границы, из-за которых этот слой вообще
/// сделан отдельно от ReaderController:
///
///  - книга, загруженная пользователем, не видна гостю ни в списке, ни по
///    прямому слагу, ни через словарь (иначе ослабленная проверка владельца
///    вернулась бы с чёрного хода и отдала чужой EPUB);
///  - вторая глава — 403 guest_only_first_chapter, причём текст в ответ не
///    попадает вовсе;
///  - перевод берётся только из справочника, без AI и без INSERT в
///    UserWords / ReaderPocketWords / UserBookProgresses.
///
/// Сервисы вызываются напрямую с живым DbContext (как в Reader/*), а не через
/// TestServer: здесь важна логика, а не хост. Маршрут и лимитер проверяются
/// отдельными тестами по атрибутам.
/// </summary>
public class GuestReaderTests
{
    private const string OwnerId = "user-1";

    // ------------------------------------------------------------ сценарий

    [Fact]
    public async Task GuestBooks_ListOnlyRowsWithoutOwner()
    {
        using var harness = new Harness();

        var books = await harness.Catalog.GetBooksAsync();

        // Сидовая книга (UploadedByUserId == null) есть, приватная — нет.
        var only = Assert.Single(books);
        Assert.Equal(Harness.PublicSlug, only.Slug);
        Assert.Equal(Harness.PublicTitle, only.Title);
        Assert.Equal("A2", only.CefrLevel);

        // Сколько глав — из снапшота, а не выдумка.
        Assert.Equal(2, only.ChapterCount);
    }

    [Fact]
    public async Task GuestBooks_NeverLeakTitleOfUsersPrivateBook()
    {
        using var harness = new Harness();

        var payload = await harness.GetBooksPayloadAsync();
        var json = JsonSerializer.Serialize(payload);

        // Даже название приватной книги не должно оказаться в ответе списка.
        Assert.DoesNotContain(Harness.PrivateTitle, json, StringComparison.Ordinal);
    }

    [Fact]
    public async Task GuestChapter1_IsReturned()
    {
        using var harness = new Harness();
        var manifest = await harness.Catalog.GetManifestAsync(Harness.PublicSlug);

        Assert.NotNull(manifest);
        Assert.True(manifest!.HasText);
        Assert.Equal(1, manifest.ChaptersAvailableToGuest);
        var link = Assert.Single(manifest.Chapters);

        var (access, chapter) = await harness.Catalog.GetChapterAsync(Harness.PublicSlug, link.Id);

        Assert.Equal(GuestChapterAccess.Granted, access);
        Assert.NotNull(chapter);
        Assert.Equal(link.Id, chapter!.Id);
        Assert.Equal(0, chapter.Index);
        Assert.Equal(2, chapter.TotalChapters);
        Assert.True(chapter.IsPreview);
        Assert.NotEmpty(chapter.Blocks);
        Assert.Equal("/onboarding", chapter.ContinueUrl);

        // Текст первой главы обязан быть настоящим (см. TestEpub.ChapterOne).
        var text = string.Join(" ", chapter.Blocks.SelectMany(b => b.Sentences).Select(s => s.Text));
        Assert.Contains("river", text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GuestChapter2_IsForbidden()
    {
        using var harness = new Harness();
        var secondId = await harness.SecondChapterIdAsync();

        var (access, chapter) = await harness.Catalog.GetChapterAsync(Harness.PublicSlug, secondId);

        Assert.Equal(GuestChapterAccess.OtherChapter, access);
        // Текст второй главы не сериализуется вовсе: null, а не «пустая глава».
        Assert.Null(chapter);
    }

    [Fact]
    public async Task Controller_Chapter2_Returns403WithDocumentedCode()
    {
        using var harness = new Harness();
        var controller = harness.CreateController();
        var secondId = await harness.SecondChapterIdAsync();

        var result = await controller.GetChapter(Harness.PublicSlug, secondId, default);

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, objectResult.StatusCode);

        var json = JsonSerializer.Serialize(objectResult.Value);
        Assert.Contains("guest_only_first_chapter", json, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UserUploadedBook_IsNotFoundForGuest()
    {
        using var harness = new Harness();
        var controller = harness.CreateController();

        // Приватная книга: по прямому, «угаданному» слагу.
        var manifest = await controller.GetBook(Harness.PrivateSlug, default);
        Assert.IsType<NotFoundObjectResult>(manifest);

        var chapter = await controller.GetChapter(Harness.PrivateSlug, "c00-deadbeef", default);
        Assert.IsType<NotFoundObjectResult>(chapter);

        // И в списке её нет.
        var payload = await harness.GetBooksPayloadAsync();
        Assert.DoesNotContain(payload.Books, b => b.Title == Harness.PrivateTitle);
    }

    [Fact]
    public async Task GuestWord_IsTranslatedFromWordLevels()
    {
        using var harness = new Harness();
        var controller = harness.CreateController();

        var result = await controller.LookupWord(Harness.PublicSlug, "River", default);

        var ok = Assert.IsType<OkObjectResult>(result);
        var dto = Assert.IsType<GuestWordLookupDto>(ok.Value);

        Assert.Equal("river", dto.Word);
        Assert.Equal("река", dto.TranslationRu);
        Assert.Equal("A1", dto.CefrLevel);
        Assert.Equal(310, dto.FreqRank);
        Assert.Equal("dictionary", dto.Source);
        Assert.Equal("/onboarding", dto.SignupUrl);
        Assert.Null(dto.MatchedForm);
    }

    [Fact]
    public async Task GuestWord_InflectedForm_FallsBackToLemma()
    {
        using var harness = new Harness();

        // «rivers» нет в справочнике, «river» есть: лемматизатор даёт форму, а
        // гость видит перевод вместо «недоступен».
        var lookup = await harness.Words.LookupAsync("rivers");

        Assert.NotNull(lookup);
        Assert.Equal("река", lookup!.TranslationRu);
        Assert.Equal("river", lookup.MatchedForm);
    }

    [Fact]
    public async Task GuestWord_MissingFromDictionary_ReturnsNullTranslationWithoutAi()
    {
        using var harness = new Harness();

        var lookup = await harness.Words.LookupAsync("zeppelinoid");

        Assert.NotNull(lookup);
        // Именно null, а не пустая строка: фронт по этому признаку рисует CTA.
        Assert.Null(lookup!.TranslationRu);
        Assert.Null(lookup.CefrLevel);
        Assert.Equal("dictionary", lookup.Source);
    }

    [Fact]
    public async Task GuestWord_InvalidInput_IsRejectedWithoutQuery()
    {
        using var harness = new Harness();
        var controller = harness.CreateController();

        foreach (var bad in new[] { "a", "12", "1234", "drop table", "" })
        {
            var result = await controller.LookupWord(Harness.PublicSlug, bad, default);
            Assert.IsType<BadRequestObjectResult>(result);
        }
    }

    [Fact]
    public async Task GuestWord_ForUnknownBook_IsNotFound()
    {
        using var harness = new Harness();
        var controller = harness.CreateController();

        var result = await controller.LookupWord(Harness.PrivateSlug, "river", default);

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task GuestWord_SecondCallIsServedFromCache()
    {
        using var harness = new Harness();

        await harness.Words.LookupAsync("river");
        var cached = harness.Cache.TryGetValue(GuestWordLookup.CacheKey("river"), out GuestWordLookupDto? entry);

        Assert.True(cached, "ответ словаря должен попасть в кэш guest:word:{word}");
        Assert.NotNull(entry);
        Assert.Equal("река", entry!.TranslationRu);
    }

    // ------------------------------------------------- отсутствие записи в БД

    [Fact]
    public async Task NoGuestRequest_WritesToUserTables()
    {
        using var harness = new Harness();

        // Полный проход гостя: список, манифест, глава 1, попытка главы 2,
        // переводы (известный, неизвестный, мусорный ввод).
        var controller = harness.CreateController();
        await controller.GetBooks(default);
        await controller.GetBook(Harness.PublicSlug, default);
        await controller.GetChapter(Harness.PublicSlug, await harness.FirstChapterIdAsync(), default);
        await controller.GetChapter(Harness.PublicSlug, await harness.SecondChapterIdAsync(), default);
        await controller.LookupWord(Harness.PublicSlug, "river", default);
        await controller.LookupWord(Harness.PublicSlug, "zeppelinoid", default);
        await controller.LookupWord(Harness.PublicSlug, "!!", default);

        Assert.Equal(0, await harness.Db.UserWords.CountAsync());
        Assert.Equal(0, await harness.Db.ReaderPocketWords.CountAsync());
        Assert.Equal(0, await harness.Db.UserBookProgresses.CountAsync());
        Assert.Equal(0, await harness.Db.BookBookmarks.CountAsync());
        Assert.Equal(0, await harness.Db.UserKnownWords.CountAsync());

        // И у самой книги прогресс не сдвинулся: read-путь ничего не пишет.
        var book = await harness.Db.Books.AsNoTracking().FirstAsync(b => b.Id == harness.PublicBookId);
        Assert.Equal(0, book.Progress);
        Assert.Equal(1, book.CurrentPage);
    }

    // ------------------------------------------------------- контракт и лимит

    [Fact]
    public void GuestController_IsAnonymousAndRoutesUnderApiGuest()
    {
        var type = typeof(GuestReaderController);

        Assert.NotNull(type.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Null(type.GetCustomAttribute<AuthorizeAttribute>());
        Assert.Equal("api/guest", type.GetCustomAttribute<RouteAttribute>()!.Template);
    }

    [Fact]
    public void GuestController_ExposesOnlyGetEndpoints()
    {
        // Любой POST/PUT/DELETE здесь — это запись от имени гостя, то есть
        // строка без пользователя или, хуже, в чужой карточке.
        var actions = GuestActions();

        Assert.Equal(4, actions.Count);
        Assert.All(actions, m => Assert.NotNull(m.GetCustomAttribute<HttpGetAttribute>()));
    }

    [Fact]
    public void GuestEndpoints_AreRateLimited()
    {
        // Лимитер обязателен на каждом действии: анонимный путь без лимита —
        // бесплатный разбор EPUB и бесплатный словарь для скрипта.
        foreach (var action in GuestActions())
        {
            var limit = action.GetCustomAttribute<EnableRateLimitingAttribute>();
            Assert.NotNull(limit);

            // Пока guest-reader нет в RateLimitPolicies (файл вне владения
            // GuestReader), действия закрыты guest-analytics — существующей
            // анонимной политикой по IP. Тест фиксирует допустимый набор, а не
            // конкретное имя, чтобы смена политики была осознанной.
            Assert.Contains(limit!.PolicyName, new[] { "guest-reader", "guest-analytics" });
        }
    }

    [Fact]
    public void GuestController_DeclaresNoPocketProgressOrBookmarkRoute()
    {
        // Ловит регресс «добавим гостю сохранение слова — что тут такого»:
        // сохранение слова живёт за онбордингом, а не на этом контроллере.
        foreach (var action in GuestActions())
        {
            var template = action.GetCustomAttribute<HttpMethodAttribute>()!.Template ?? string.Empty;
            Assert.DoesNotContain("pocket", template, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("progress", template, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("position", template, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("bookmark", template, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("finished", template, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Theory]
    [InlineData("river")]
    [InlineData("word,")]
    [InlineData("don't")]
    [InlineData("well-known")]
    [InlineData("  Bananas!  ")]
    public void NormalizeInput_KeepsWordsAndStripsPunctuation(string raw)
    {
        var normalized = GuestWordLookup.NormalizeInput(raw);

        Assert.NotNull(normalized);
        Assert.DoesNotContain(",", normalized!, StringComparison.Ordinal);
        Assert.DoesNotContain("!", normalized, StringComparison.Ordinal);
        Assert.Equal(normalized, normalized.ToLowerInvariant());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("a")]
    [InlineData("7")]
    [InlineData("<script>")]
    [InlineData("слово")]
    public void NormalizeInput_RejectsNonWords(string raw)
    {
        Assert.Null(GuestWordLookup.NormalizeInput(raw));
    }

    // ------------------------------------------------------------- окружение

    private static List<MethodInfo> GuestActions() =>
        typeof(GuestReaderController)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes().Any(a => a is HttpMethodAttribute))
            .ToList();

    /// <summary>
    /// Две книги с одним EPUB-файлом: системная (UploadedByUserId == null) и
    /// приватная копия того же текста. Второй файл не нужен: снапшот
    /// переиспользуется по хэшу, а приватность проверяется запросом.
    /// </summary>
    private sealed class Harness : IDisposable
    {
        public const string PublicTitle = "Storm Over the River";
        public const string PublicSlug = "storm-over-the-river";
        public const string PrivateTitle = "Private Draft Nobody Should Read";
        public const string PrivateSlug = "private-draft-nobody-should-read";

        public string Root { get; }
        public ApplicationDbContext Db { get; }
        public MemoryCache Cache { get; }
        public ReaderContentService Content { get; }
        public GuestReaderCatalog Catalog { get; }
        public GuestWordLookup Words { get; }
        public int PublicBookId { get; }

        public Harness()
        {
            Root = Path.Combine(AppContext.BaseDirectory, "elp-guest-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Root);

            var epub = TestEpub.Create(Root);

            var options = new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase("guest-" + Guid.NewGuid().ToString("N"))
                .Options;
            Db = new ApplicationDbContext(options);

            Cache = new MemoryCache(new MemoryCacheOptions());
            var environment = new TestWebEnvironment(Root);
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:Key"] = new string('k', 40)
                })
                .Build();

            var bookService = new BookService(Db, environment, NullLogger<BookService>.Instance, Cache);
            var assets = new ReaderAssetService(environment, configuration);
            var parser = new BookSnapshotParser(assets, NullLogger<BookSnapshotParser>.Instance);
            Content = new ReaderContentService(
                Db,
                bookService,
                parser,
                assets,
                new LemmatizerService(),
                Cache,
                environment,
                NullLogger<ReaderContentService>.Instance);

            var publicBook = new Book
            {
                Title = PublicTitle,
                Author = "Lexicon Stories",
                Language = "en",
                FilePath = epub.RelativePath,
                FileSize = new FileInfo(epub.FilePath).Length,
                CefrLevel = "a2",
                UploadedByUserId = null
            };

            var privateBook = new Book
            {
                Title = PrivateTitle,
                Author = "A User",
                Language = "en",
                FilePath = epub.RelativePath,
                FileSize = new FileInfo(epub.FilePath).Length,
                CefrLevel = "b1",
                UploadedByUserId = OwnerId
            };

            Db.Books.AddRange(publicBook, privateBook);
            Db.WordLevels.AddRange(
                new WordLevel { Text = "river", CefrLevel = "a1", TranslationRu = "река", FreqRank = 310 },
                new WordLevel { Text = "letter", CefrLevel = "a2", TranslationRu = "письмо", FreqRank = 900 });
            Db.SaveChanges();

            PublicBookId = publicBook.Id;

            Catalog = new GuestReaderCatalog(Db, Content, Cache);
            Words = new GuestWordLookup(Db, new LemmatizerService(), Cache, NullLogger<GuestWordLookup>.Instance);
        }

        public GuestReaderController CreateController() => new(Catalog, Words);

        public async Task<GuestBookListResponse> GetBooksPayloadAsync()
        {
            var controller = CreateController();
            var ok = Assert.IsType<OkObjectResult>(await controller.GetBooks(default));
            return Assert.IsType<GuestBookListResponse>(ok.Value);
        }

        private async Task<string[]> ChapterIdsAsync()
        {
            var book = await Db.Books.AsNoTracking().FirstAsync(b => b.Id == PublicBookId);
            var snapshot = await Content.EnsureSnapshotAsync(book)
                           ?? throw new InvalidOperationException("снапшот тестовой книги не собрался");

            return snapshot.Chapters.Select(c => c.Id).ToArray();
        }

        public async Task<string> FirstChapterIdAsync() => (await ChapterIdsAsync())[0];

        public async Task<string> SecondChapterIdAsync() => (await ChapterIdsAsync())[1];

        public void Dispose()
        {
            Db.Dispose();
            Cache.Dispose();
            try
            {
                Directory.Delete(Root, recursive: true);
            }
            catch
            {
                // временная папка не должна ронять тест
            }
        }
    }
}
