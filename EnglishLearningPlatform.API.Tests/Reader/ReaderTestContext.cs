using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Reader;

internal sealed class ReaderTestContext : IDisposable
{
    public string Root { get; }
    public string BookPath { get; }
    public string BookFile { get; }
    public string Hash { get; }
    public ApplicationDbContext Db { get; }
    public TestWebEnvironment Environment { get; }
    public ReaderAssetService Assets { get; }
    public BookSnapshotParser Parser { get; }
    public ReaderContentService Content { get; }
    public ReaderProgressService Progress { get; }
    public ReaderPocketService Pocket { get; }
    public Book Book { get; }
    public MemoryCache Cache { get; }

    private ReaderTestContext(bool gutenbergMarkers)
    {
        Root = Path.Combine(AppContext.BaseDirectory, "elp-reader-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Root);

        var epub = TestEpub.Create(Root, gutenbergMarkers);
        BookPath = epub.FilePath;
        BookFile = epub.RelativePath;
        Hash = epub.Hash;

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("reader-" + Guid.NewGuid().ToString("N"))
            .Options;
        Db = new ApplicationDbContext(options);

        Environment = new TestWebEnvironment(Root);
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = new string('k', 40)
            })
            .Build();

        Cache = new MemoryCache(new MemoryCacheOptions());
        var bookService = new BookService(
            Db, Environment, NullLogger<BookService>.Instance, Cache);

        Assets = new ReaderAssetService(Environment, configuration);
        Parser = new BookSnapshotParser(Assets, NullLogger<BookSnapshotParser>.Instance);
        Content = new ReaderContentService(
            Db,
            bookService,
            Parser,
            Assets,
            new LemmatizerService(),
            Cache,
            Environment,
            NullLogger<ReaderContentService>.Instance);

        var activity = new ActivityService(Db);
        Progress = new ReaderProgressService(Db, Content, activity);
        Pocket = new ReaderPocketService(
            Db,
            Content,
            new DictionaryService(Db),
            new LemmatizerService(),
            NullLogger<ReaderPocketService>.Instance);

        Book = new Book
        {
            Title = "Reader Test Book",
            Author = "Test",
            Language = "en",
            FilePath = BookFile,
            FileSize = new FileInfo(BookPath).Length,
            UploadedByUserId = "user-1",
            CurrentPage = 1,
            Progress = 0
        };
        Db.Books.Add(Book);
        Db.SaveChanges();
    }

    public static ReaderTestContext Create(bool gutenbergMarkers = false) =>
        new(gutenbergMarkers);

    public async Task<ReaderSnapshot> SnapshotAsync() =>
        await Content.EnsureSnapshotAsync(Book) ?? throw new InvalidOperationException("Snapshot was not built.");

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
