using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// W2.2c, задача 2: правовая граница превью.
///
/// Витрина показывает первые строки, а не «прочитать книгу бесплатно». Здесь
/// проверяются три вещи:
///  - текст берётся только из public domain: из сида рассказа и из EPUB
///    Системной копии (строка Books без владельца);
///  - приватный EPUB пользователя не становится публичной цитатой, даже когда
///    его название совпадает с классикой из Gutenberg;
///  - цена сборки превью ограничена: размер файла и кэш, чтобы краулер не
///    заставлял сервер распаковывать архив на каждый запрос.
/// </summary>
public class PublicCatalogPreviewTests : IDisposable
{
    private readonly PublicCatalogHarness _harness = new();

    public void Dispose() => _harness.Dispose();

    private static int CountWords(string text) =>
        text.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;

    /// <summary>
    /// Создаёт книгу тем же кодом, что и POST /api/books/story: настоящий EPUB в
    /// uploads/books. owner == null — это и есть системная копия из whitelist'а.
    /// </summary>
    private async Task<Book> CreateEpubBookAsync(string? owner, string title, int sentences, string marker)
    {
        var seeder = new StorySeeder(_harness.Context, _harness.Environment, NullLogger<StorySeeder>.Instance);

        var book = await seeder.CreateBookForUserAsync(owner!, new StorySeedData
        {
            Title = title,
            Author = "Herman Melville",
            CefrLevel = "c1",
            Description = "generated for the preview test",
            Paragraphs = Enumerable.Range(0, sentences)
                .Select(i => i == 0
                    ? $"The {marker} ship sailed at midnight."
                    : $"Sentence {i} keeps the voyage going.")
                .ToList()
        }, 1);

        Assert.NotNull(book);
        return book!;
    }

    private string EpubPath(Book book) =>
        Path.Combine(_harness.Environment.ContentRootPath, "uploads", "books", book.FilePath);

    // ------------------------------------------------------------------ сидах

    [Fact]
    public async Task StoryPreviewComesFromSeed_AndStaysShort()
    {
        var catalog = await _harness.CreateCatalogAsync();

        var kitten = await catalog.FindAsync("the-lost-kitten");
        Assert.NotNull(kitten);
        Assert.False(string.IsNullOrWhiteSpace(kitten!.Preview));
        Assert.Contains("small kitten", kitten.Preview);
        // Короткий рассказ отдаётся целиком — резать нечего
        Assert.DoesNotContain("…", kitten.Preview);

        var longTale = await catalog.FindAsync("the-long-sea-tale");
        Assert.NotNull(longTale);

        var preview = longTale!.Preview!;
        Assert.True(
            CountWords(preview) <= PublicCatalogService.PreviewWordLimit,
            $"превью вышло в {CountWords(preview)} слов при лимите {PublicCatalogService.PreviewWordLimit}");
        Assert.EndsWith("…", preview);

        var books = await catalog.GetCatalogAsync();
        Assert.All(
            books.Where(b => b.Preview != null),
            b => Assert.True(
                CountWords(b.Preview!) <= PublicCatalogService.PreviewWordLimit,
                $"{b.Title}: превью длиннее лимита"));
    }

    [Fact]
    public void TakePreview_CutsAtSentenceBoundary()
    {
        var text = string.Join(" ", Enumerable.Range(0, 400)
            .Select(i => $"The keeper lit the lamp again and the sea went on {i}."));

        var preview = PublicCatalogService.TakePreview(text);

        Assert.True(CountWords(preview) <= PublicCatalogService.PreviewWordLimit);
        // Обрывок на середине предложения выглядит как ошибка, цитата — как цитата
        Assert.EndsWith(".", preview[..^1]);
        Assert.EndsWith("…", preview);
    }

    [Fact]
    public void TakePreview_KeepsShortTextIntact()
    {
        const string text = "Mia found a small kitten behind the school.";

        Assert.Equal(text, PublicCatalogService.TakePreview(text));
        Assert.Equal(string.Empty, PublicCatalogService.TakePreview("   "));
    }

    // ------------------------------------------------------------------- EPUB

    [Fact]
    public async Task PrivateCopyOfAClassic_NeverBecomesThePublicPreview()
    {
        var book = await CreateEpubBookAsync("user-9", "Moby-Dick", sentences: 40, marker: "private");
        Assert.Equal("user-9", book.UploadedByUserId);
        Assert.True(File.Exists(EpubPath(book)), "файл должен существовать: тест про чтение, а не про отсутствие");

        var catalog = await _harness.CreateCatalogAsync();
        var moby = await catalog.FindAsync("moby-dick");

        Assert.NotNull(moby);
        Assert.Equal(CatalogKinds.Classic, moby!.Kind);
        // Ни строки из чужого файла, ни объёма чужого файла: классика остаётся
        // записью сида, пока у сервиса нет собственной копии
        Assert.Null(moby.Preview);
        Assert.Null(moby.WordCount);
    }

    [Fact]
    public async Task SystemCopyOfAClassic_IsQuotedFromItsOwnEpub()
    {
        var book = await CreateEpubBookAsync(owner: null, "Moby-Dick", sentences: 40, marker: "archive");
        Assert.Null(book.UploadedByUserId);

        var catalog = await _harness.CreateCatalogAsync();
        var moby = await catalog.FindAsync("moby-dick");

        Assert.NotNull(moby);
        Assert.False(string.IsNullOrWhiteSpace(moby!.Preview));
        Assert.Contains("archive ship sailed at midnight", moby.Preview);
        Assert.True(CountWords(moby.Preview!) <= PublicCatalogService.PreviewWordLimit);
        // Системная копия не плодит вторую книгу, а объём из неё берётся только
        // если он действительно посчитан: 0 остаётся «неизвестно», а не «ноль слов»
        Assert.Null(moby.WordCount);
        Assert.Equal(1, (await catalog.GetCatalogAsync()).Count(b => b.Title == "Moby-Dick"));
    }

    [Fact]
    public async Task SystemCopyWithoutFile_DegradesToNoPreview()
    {
        var catalog = await _harness.CreateCatalogAsync((context, _) =>
        {
            context.Books.Add(PublicCatalogHarness.SystemBook(
                701, "Sea Stories From The Archive", "missing-file.epub", words: 1234));
            return Task.CompletedTask;
        });

        var book = await catalog.FindAsync("sea-stories-from-the-archive");

        Assert.NotNull(book);
        // Файла нет — предсказуемая деградация: карточка остаётся, текста нет
        Assert.Null(book!.Preview);
        Assert.Equal(1234, book.WordCount);
    }

    [Fact]
    public async Task OversizedSystemEpub_IsNotUnpackedForAPreview()
    {
        var catalog = await _harness.CreateCatalogAsync((context, _) =>
        {
            context.Books.Add(new Book
            {
                Id = 702,
                Title = "The Very Large Archive Book",
                Author = "Archive",
                Language = "en",
                CefrLevel = "b2",
                Description = "too heavy to unpack for a teaser",
                FilePath = "does-not-matter.epub",
                // Больше лимита — распаковку даже не начинаем
                FileSize = 40L * 1024 * 1024,
                WordCount = 900_000,
                UploadedByUserId = null
            });
            return Task.CompletedTask;
        });

        var book = await catalog.FindAsync("the-very-large-archive-book");

        Assert.NotNull(book);
        Assert.Null(book!.Preview);
        Assert.Equal(900_000, book.WordCount);
    }

    [Fact]
    public async Task PreviewIsCachedPerBook_AndSurvivesALostFile()
    {
        var book = await CreateEpubBookAsync(owner: null, "Moby-Dick", sentences: 40, marker: "cached");

        var catalog = await _harness.CreateCatalogAsync();
        var first = await catalog.FindAsync("moby-dick");

        Assert.NotNull(first);
        Assert.False(string.IsNullOrWhiteSpace(first!.Preview));

        // Превью лежит в кэше под своим ключом — краулер не платит распаковку
        Assert.True(
            _harness.Cache.TryGetValue(
                PublicCatalogService.PreviewCacheKeyPrefix + book.Id,
                out string? cachedPreview),
            "превью системной копии должно кешироваться по bookId");
        Assert.Equal(first.Preview, cachedPreview);

        // Каталог сброшен, файл пропал — ответ всё равно отдаётся из кэша превью
        _harness.Cache.Remove(PublicCatalogService.CatalogCacheKey);
        File.Delete(EpubPath(book));

        var rebuilt = await _harness.CreateCatalogAsync();
        var second = await rebuilt.FindAsync("moby-dick");

        Assert.Equal(first.Preview, second!.Preview);
    }
}
