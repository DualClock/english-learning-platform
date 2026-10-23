using System.Text.Json;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// Общая фикстура для тестов публичного каталога: временный ContentRoot с
/// собственным stories.json, InMemory-база и тот же MemoryCache, что живёт в
/// процессе.
///
/// Каталог обложек (PopularBooksService) в тестах прогревается заранее: иначе
/// проверка приватности зависела бы от доступности Open Library.
/// </summary>
public sealed class PublicCatalogHarness : IDisposable
{
    public PublicCatalogHarness()
    {
        Root = Path.Combine(AppContext.BaseDirectory, "elp-catalog-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Root);
        WriteStoriesSeed();

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("catalog-" + Guid.NewGuid().ToString("N"))
            .Options;

        Context = new ApplicationDbContext(options);
        Environment = new TestWebHostEnvironment { ContentRootPath = Root };
        Cache = new MemoryCache(new MemoryCacheOptions());

        Popular = new PopularBooksService(
            Context, Environment, Cache, NullLogger<PopularBooksService>.Instance);

        var covers = Popular.GetPopularBooks()
            .Select(b => new PopularBookInfo
            {
                Title = b.Title,
                Author = b.Author,
                GutenbergId = b.GutenbergId,
                Description = b.Description,
                CefrLevel = b.CefrLevel,
                CoverUrl = $"https://covers.openlibrary.org/b/id/{b.GutenbergId}-M.jpg"
            })
            .ToList();

        Cache.Set(PopularBooksService.PopularCoversCacheKey, covers, TimeSpan.FromHours(24));
    }

    public string Root { get; }
    public ApplicationDbContext Context { get; }
    public TestWebHostEnvironment Environment { get; }
    public IMemoryCache Cache { get; }
    public PopularBooksService Popular { get; }

    public async Task<PublicCatalogService> CreateCatalogAsync(
        Func<ApplicationDbContext, TestWebHostEnvironment, Task>? seedBooks = null)
    {
        if (seedBooks != null)
        {
            await seedBooks(Context, Environment);
            await Context.SaveChangesAsync();
        }

        return new PublicCatalogService(
            Context,
            new StorySeeder(Context, Environment, NullLogger<StorySeeder>.Instance),
            Popular,
            Cache,
            NullLogger<PublicCatalogService>.Instance);
    }

    public async Task<CatalogController> CreateControllerAsync(
        Func<ApplicationDbContext, TestWebHostEnvironment, Task>? seedBooks = null) =>
        new(await CreateCatalogAsync(seedBooks));

    /// <summary>
    /// Два градированных рассказа в формате Data/Seed/stories.json: один короче
    /// лимита превью, второй заведомо длиннее — так проверка «превью обязано
    /// резаться» не зависит от боевого сида.
    /// </summary>
    private void WriteStoriesSeed()
    {
        var longText = string.Join(
            " ",
            Enumerable.Range(0, 60).Select(_ => "The lighthouse keeper counted the waves before dawn."));

        var stories = new[]
        {
            new
            {
                Title = "The Lost Kitten",
                Author = "Lexicon Stories",
                CefrLevel = "a1",
                Description = "A short story about a lost kitten.",
                Paragraphs = new[]
                {
                    "Mia found a small kitten behind the school.",
                    "It was cold and very hungry.",
                    "Mia gave it her warm sandwich."
                }
            },
            new
            {
                Title = "The Long Sea Tale",
                Author = "Lexicon Stories",
                CefrLevel = "b1",
                Description = "A deliberately long graded story.",
                Paragraphs = new[] { longText }
            }
        };

        var seedDir = Path.Combine(Root, "Data", "Seed");
        Directory.CreateDirectory(seedDir);
        File.WriteAllText(Path.Combine(seedDir, "stories.json"), JsonSerializer.Serialize(stories));
    }

    /// <summary>Системная копия: строка Books без владельца.</summary>
    public static Book SystemBook(int id, string title, string? filePath = null, int words = 0, string? level = null) =>
        new()
        {
            Id = id,
            Title = title,
            Author = "Archive",
            Language = "en",
            CefrLevel = level,
            FilePath = filePath ?? $"{Guid.NewGuid()}.epub",
            FileSize = 1024,
            WordCount = words,
            UploadedByUserId = null
        };

    /// <summary>Книга пользователя: приватна по определению.</summary>
    public static Book PrivateBook(int id, string title, string owner, string? filePath = null, int words = 0) =>
        new()
        {
            Id = id,
            Title = title,
            Author = "Someone",
            Language = "en",
            FilePath = filePath ?? $"{Guid.NewGuid()}.epub",
            FileSize = 1024,
            WordCount = words,
            UploadedByUserId = owner
        };

    public void Dispose()
    {
        Context.Dispose();

        try
        {
            if (Directory.Exists(Root)) Directory.Delete(Root, recursive: true);
        }
        catch (IOException)
        {
            // Временная папка теста не должна влиять на следующий тест
        }
    }
}
