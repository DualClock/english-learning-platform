using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Guest;
using EnglishLearningPlatform.API.Services.Reader;
using EnglishLearningPlatform.API.Tests.Reader;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Guest;

/*
 * Регрессия локального GO-гейта (26.10.2026).
 *
 * Что случилось. GuestReaderCatalog показывает только строки Books с
 * UploadedByUserId == null. Тесты этого класса проверяли СВОЙСТВО ФИЛЬТРА —
 * «чужая книга не протечёт», — и потому были зелёными, когда в базе не было
 * НИ ОДНОЙ системной строки: пустое множество тривиально проходит любой
 * фильтр. В итоге /api/guest/books отдавал {"total":0}, а /reader/preview/<slug>
 * открывался — но только благодаря строке, заведённой руками в SQL во время
 * ручного прогона. На чистой базе гостевая витрина была пуста целиком.
 *
 * Что проверяем здесь: положительное утверждение — системные копии рассказов
 * действительно появляются (GuestCatalogSeeder) и попадают в гостевой каталог.
 * Тест на приватность остаётся в GuestReaderTests и продолжает работать.
 */
public class GuestCatalogSeederTests
{
    [Fact]
    public async Task Seeder_CreatesSystemCopies_ThatGuestCatalogReturns()
    {
        using var harness = new Harness();

        var result = await harness.SeedAsync();

        // Рассказов в сиде восемь; проверяем, что созданы все и ни один не пропущен.
        Assert.True(result.Created > 0, "сидер не создал ни одной системной копии");
        Assert.Equal(0, result.Skipped);

        // Утверждение про БД: строки без владельца действительно появились.
        var owners = await harness.Db.Books
            .AsNoTracking()
            .Select(b => b.UploadedByUserId)
            .ToListAsync();
        Assert.Equal(result.Created, owners.Count);
        Assert.All(owners, owner => Assert.Null(owner));

        // И то, ради чего всё: гостевой каталог отдаёт их, а не пустой список.
        var after = await harness.Catalog.GetBooksAsync();
        Assert.True(after.Count > 0, "гостевой каталог пуст при непустой таблице — регресс GO-гейта вернулся");
    }

    [Fact]
    public async Task Seeder_IsIdempotent_SecondRunCreatesNothing()
    {
        using var harness = new Harness();

        var first = await harness.SeedAsync();
        Assert.True(first.Created > 0);

        var second = await harness.SeedAsync();

        Assert.Equal(0, second.Created);
        Assert.Equal(first.Created, second.Skipped);
        Assert.Equal(first.Created, await harness.Db.Books.CountAsync());
    }

    [Fact]
    public async Task Seeder_DoesNotTouchUsersPrivateCopyOfSameStory()
    {
        using var harness = new Harness();

        // Пользователь уже добавил этот рассказ себе — со своим прогрессом.
        var story = harness.Stories.GetStories()[0];

        var privacy = harness.Db.Books.Add(new Book
        {
            Title = story.Title,
            Author = story.Author,
            Language = "en",
            Description = story.Description,
            CefrLevel = story.CefrLevel,
            FilePath = "user-copy.epub",
            FileSize = 1,
            UploadedByUserId = "user-1"
        }).Entity;
        await harness.Db.SaveChangesAsync();

        await harness.SeedAsync();

        // Приватная копия остаётся у владельца и не становится публичной.
        var reloaded = await harness.Db.Books.AsNoTracking().SingleAsync(b => b.Id == privacy.Id);
        Assert.Equal("user-1", reloaded.UploadedByUserId);

        // И в каталоге гостя её нет: его запись — другая строка, без владельца.
        var guest = await harness.Catalog.GetBooksAsync();
        Assert.Contains(guest, b => b.Title == story.Title);
        Assert.Equal(1, await harness.Db.Books.CountAsync(b =>
            b.Title == story.Title && b.UploadedByUserId == null));
    }

    /// <summary>Минимальное окружение: реальный SQLite + сид из репозитория.</summary>
    private sealed class Harness : IDisposable
    {
        public string Root { get; }
        public ApplicationDbContext Db { get; }
        public MemoryCache Cache { get; }
        public StorySeeder Stories { get; }
        public GuestReaderCatalog Catalog { get; }
        private readonly GuestCatalogSeeder _seeder;

        public Harness()
        {
            Root = Path.Combine(AppContext.BaseDirectory, "elp-guest-seed-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(Root, "uploads", "books"));
            Directory.CreateDirectory(Path.Combine(Root, "uploads", "covers"));

            // StorySeeder читает сид по пути относительно ContentRoot
            // (Data/Seed/stories.json). Тестовому окружению этот файл нужен
            // ровно там же — копируем из репозитория, а не переписываем восемь
            // рассказов в тесте: иначе тест проверяет выдумку, а не боевой сид.
            CopySeedIntoRoot(Root);

            var options = new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase("guest-seed-" + Guid.NewGuid().ToString("N"))
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
            var content = new ReaderContentService(
                Db,
                bookService,
                parser,
                assets,
                new LemmatizerService(),
                Cache,
                environment,
                NullLogger<ReaderContentService>.Instance);

            // Тот же путь загрузки сида, что у боевого StorySeeder: файл лежит
            // в репозитории, а не в тестовом каталоге.
            Stories = new StorySeeder(Db, environment, NullLogger<StorySeeder>.Instance);
            Catalog = new GuestReaderCatalog(Db, content, Cache);
            _seeder = new GuestCatalogSeeder(Db, Stories, environment, NullLogger<GuestCatalogSeeder>.Instance);
        }

        public Task<GuestCatalogSeeder.Result> SeedAsync() => _seeder.SeedAsync();

        /// <summary>
        /// Кладёт Data/Seed/stories.json в тестовый ContentRoot: StorySeeder
        /// ищет сид относительно него, как и в проде.
        /// </summary>
        private static void CopySeedIntoRoot(string root)
        {
            var seedDir = Path.Combine(root, "Data", "Seed");
            Directory.CreateDirectory(seedDir);

            // Ищем файл вверх от bin/: тестовый процесс живёт в
            // .../EnglishLearningPlatform.API.Tests/bin/Debug/net10.0.
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "EnglishLearningPlatform.API", "Data", "Seed", "stories.json");
                if (File.Exists(candidate))
                {
                    File.Copy(candidate, Path.Combine(seedDir, "stories.json"), overwrite: true);
                    return;
                }
                dir = dir.Parent;
            }

            throw new FileNotFoundException(
                "Не найден EnglishLearningPlatform.API/Data/Seed/stories.json — тест обязан гонять боевой сид, а не выдумку.");
        }

        public void Dispose()
        {
            Db.Dispose();
            Cache.Dispose();
            try
            {
                if (Directory.Exists(Root))
                {
                    Directory.Delete(Root, recursive: true);
                }
            }
            catch
            {
                // временный каталог уберёт ОС
            }
        }
    }
}
