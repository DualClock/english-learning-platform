using System.IO.Compression;
using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// Прогрев озвучки главы (R8).
///
/// Прогрев — это расход бюджета платформы за пользователя, поэтому проверяется
/// не «файлы появились», а двойной счёт: первый прогрев тратит символы, второй
/// не тратит ничего, а исчерпанный лимит останавливает прогрев без падения.
/// </summary>
public class ChapterSpeechPrefetcherTests : IDisposable
{
    private readonly string _root;
    private readonly ApplicationDbContext _db;
    private readonly SqliteConnection? _connection;

    public ChapterSpeechPrefetcherTests()
    {
        _root = Path.Combine(AppContext.BaseDirectory, "elp-prefetch-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);
        _db = CreateDb(out _connection);
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection?.Dispose();
        try
        {
            Directory.Delete(_root, recursive: true);
        }
        catch (IOException)
        {
            // временная папка теста, чистить её не обязательно
        }
    }

    private static ApplicationDbContext CreateDb(out SqliteConnection? connection)
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlite(connection)
            .Options;
        var db = new ApplicationDbContext(options);
        db.Database.EnsureCreated();
        return db;
    }

    private AzureSpeechService CreateAzure(
        ApplicationDbContext db,
        CountingHandler handler,
        int limit = 400_000)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Azure:Speech:Key"] = "test-key",
                ["Azure:Speech:Region"] = "westeurope",
                ["Azure:Speech:Voice"] = AzureSpeechService.DefaultVoice,
                ["Azure:Speech:MonthlyCharLimit"] = limit.ToString(),
            })
            .Build();

        return new AzureSpeechService(
            db,
            new SingleHandlerFactory(handler),
            new RootEnvironment(_root),
            configuration,
            NullLogger<AzureSpeechService>.Instance);
    }

    /// <summary>
    /// Книга-заготовка с готовым снимком: одна глава из N предложений по ≈100
    /// символов. Снимок пишется прямо в БД тем же JSON, что сохраняет парсер —
    /// тест про прогрев и бюджет, а не про разбор EPUB.
    /// </summary>
    private int SeedBook(int sentences)
    {
        var snapshot = new ReaderSnapshot
        {
            ParserVersion = BookSnapshotParser.ParserVersion,
            WordCount = sentences * 15,
            Chapters = new List<ReaderChapter>
            {
                new()
                {
                    Id = "c01",
                    Title = "Chapter One",
                    Level = 1,
                    WordStart = 0,
                    WordCount = sentences * 15,
                    Blocks = new List<ReaderBlock>
                    {
                        new()
                        {
                            Id = "b1",
                            Type = ReaderBlockTypes.Paragraph,
                            Sentences = Enumerable.Range(1, sentences)
                                .Select(i => new ReaderSentence
                                {
                                    Id = $"c01-b1-s{i}",
                                    Text = $"Sentence {i} of the chapter: Alice was beginning to get very tired of sitting by her sister.",
                                    WordStart = (i - 1) * 15,
                                    WordCount = 15,
                                })
                                .ToList(),
                        },
                    },
                },
            },
        };

        var json = JsonSerializer.SerializeToUtf8Bytes(snapshot, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        });

        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true))
        {
            gzip.Write(json);
        }

        var entity = new BookContentSnapshot
        {
            ContentHash = Guid.NewGuid().ToString("N"),
            ParserVersion = BookSnapshotParser.ParserVersion,
            JsonGzip = output.ToArray(),
            ChapterCount = 1,
            WordCount = snapshot.WordCount,
        };
        _db.BookContentSnapshots.Add(entity);
        _db.SaveChanges();

        var book = new Book
        {
            Title = "Alice",
            Author = "Carroll",
            Language = "en",
            FilePath = "unused.epub",
            FileSize = 0,
            ContentSnapshotId = entity.Id,
        };
        _db.Books.Add(book);
        _db.SaveChanges();
        return book.Id;
    }

    [Fact]
    public async Task Прогрев_кладёт_озвучку_в_кэш_AzureSpeechService()
    {
        var bookId = SeedBook(3);
        var handler = new CountingHandler();
        var azure = CreateAzure(_db, handler);
        var prefetcher = CreatePrefetcher(azure);

        var spent = await prefetcher.WarmChapterAsync(bookId, "c01");

        Assert.True(spent > 0, "первый прогрев обязан потратить символы");

        var snapshot = await CreateContent().EnsureSnapshotAsync(bookId);
        var chapter = ReaderContentService.FindChapter(snapshot!, "c01");
        Assert.NotNull(chapter);

        var texts = chapter!.Blocks.SelectMany(b => b.Sentences).Select(s => s.Text).ToList();
        Assert.NotEmpty(texts);

        foreach (var text in texts)
        {
            Assert.True(
                File.Exists(Path.Combine(azure.CacheDirectory, azure.CacheName(text))),
                $"нет файла в кэше для «{text}»");
        }
    }

    [Fact]
    public async Task Второй_прогрев_не_тратит_квоту()
    {
        var bookId = SeedBook(3);
        var handler = new CountingHandler();
        var azure = CreateAzure(_db, handler);
        var prefetcher = CreatePrefetcher(azure);

        var first = await prefetcher.WarmChapterAsync(bookId, "c01");
        Assert.True(first > 0, "первый прогрев обязан потратить символы");

        var usedAfterFirst = await azure.GetUsedCharsAsync();
        var callsAfterFirst = handler.Calls;
        Assert.True(callsAfterFirst > 0);

        // Второй прогрев: файлы уже в кэше, Azure не должен вызываться вовсе.
        var second = await prefetcher.WarmChapterAsync(bookId, "c01");

        Assert.Equal(0, second);
        Assert.Equal(usedAfterFirst, await azure.GetUsedCharsAsync());
        Assert.Equal(callsAfterFirst, handler.Calls);
    }

    [Fact]
    public async Task Исчерпанный_лимит_останавливает_прогрев_без_падения()
    {
        // 1 000 — минимальный бюджет, который принимает AzureSpeechService
        // (Math.Max(1_000, ...)). Каждая фраза уникальна: кэш ключуется по тексту,
        // и повтор той же фразы не стоил бы ни символа.
        var azure = CreateAzure(_db, new CountingHandler(), limit: 1_000);
        var spentBefore = 0;
        var number = 0;
        while (spentBefore <= 900)
        {
            var phrase = $"Sentence number {++number} of the chapter: Alice was beginning to get very tired.";
            Assert.NotNull(await azure.SynthesizeAsync(phrase));
            spentBefore += AzureSpeechService.MeasureChars(phrase);
        }

        Assert.Equal(spentBefore, await azure.GetUsedCharsAsync());
        Assert.True(spentBefore <= 1_000);

        // Прогрев идёт по забитому бюджету: ни одного лишнего символа, и главное —
        // без исключения. Остатка (менее 100) не хватает ни на одно предложение главы.
        var bookId = SeedBook(3);
        var prefetcher = CreatePrefetcher(azure);
        var spent = await prefetcher.WarmChapterAsync(bookId, "c01");

        Assert.Equal(0, spent);
        Assert.Equal(spentBefore, await azure.GetUsedCharsAsync());
    }

    [Fact]
    public async Task Пачка_ограничена_константой_на_заход()
    {
        var bookId = SeedBook(200);
        var azure = CreateAzure(_db, new CountingHandler());
        var prefetcher = CreatePrefetcher(azure);

        var spent = await prefetcher.WarmChapterAsync(bookId, "c01");

        Assert.True(spent > 0);
        Assert.True(
            spent <= ChapterSpeechPrefetcher.MaxCharsPerRun,
            $"за один заход потрачено {spent} из {ChapterSpeechPrefetcher.MaxCharsPerRun} допустимых");
    }

    private ChapterSpeechPrefetcher CreatePrefetcher(AzureSpeechService azure) =>
        new(() => CreateContent(), () => azure, NullLogger<ChapterSpeechPrefetcher>.Instance);

    private ReaderContentService CreateContent()
    {
        var environment = new RootEnvironment(_root);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:Key"] = new string('k', 40) })
            .Build();
        var assets = new ReaderAssetService(environment, configuration);

        return new ReaderContentService(
            _db,
            new BookService(_db, environment, NullLogger<BookService>.Instance, cache),
            new BookSnapshotParser(assets, NullLogger<BookSnapshotParser>.Instance),
            assets,
            new LemmatizerService(),
            cache,
            environment,
            NullLogger<ReaderContentService>.Instance);
    }

    private sealed class CountingHandler : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(new byte[] { 0xFF, 0xFB, 0x90, 0x64 })
            });
        }
    }

    private sealed class SingleHandlerFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class RootEnvironment(string root) : IWebHostEnvironment, IHostEnvironment
    {
        public string ApplicationName { get; set; } = "test";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string EnvironmentName { get; set; } = "Test";
        public string WebRootName { get; set; } = "wwwroot";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = root;
        public string ContentRootPath { get; set; } = root;
    }
}
