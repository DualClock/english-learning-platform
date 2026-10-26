using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// Сидер примеров к словам (R11). Примеры — контент, но сидер — код с логикой:
/// он пишет в общую таблицу WordLevels, которую читают словарь, читалка и
/// гостевая справка, поэтому идемпотентность и поведение на битых данных
/// проверяются тестом, а не «на глаз» после старта.
/// </summary>
public class WordExampleSeederTests : IDisposable
{
    private readonly string _root;
    private readonly ApplicationDbContext _context;
    private readonly WordExampleSeeder _seeder;

    public WordExampleSeederTests()
    {
        // Не в системный temp: на этой машине C:\Temp закрыт для процесса,
        // поэтому временный корень лежит рядом с тестовой сборкой — так же,
        // как у StorySeederCoverTests.
        _root = Path.Combine(AppContext.BaseDirectory, "elp-word-examples-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(_root, "Data", "Seed"));

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("word-examples-" + Guid.NewGuid().ToString("N"))
            .Options;

        _context = new ApplicationDbContext(options);
        _seeder = new WordExampleSeeder(
            _context,
            new FakeEnvironment(_root),
            NullLogger<WordExampleSeeder>.Instance);
    }

    public void Dispose()
    {
        _context.Dispose();
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    private void WriteSeed(string json) =>
        File.WriteAllText(
            Path.Combine(_root, WordExampleSeeder.SeedFileRelativePath),
            json);

    private void SeedWord(string text, string cefr = "a1") =>
        _context.WordLevels.Add(new WordLevel
        {
            Text = text,
            CefrLevel = cefr,
            FreqRank = 1,
            TranslationRu = "перевод"
        });

    [Fact]
    public async Task SeedAsync_SecondRunUpdatesNothing()
    {
        SeedWord("river");
        await _context.SaveChangesAsync();
        WriteSeed("""
        [
          { "text": "river", "example": "The river was deep and cold.", "exampleRu": "Река была глубокой и холодной." }
        ]
        """);

        var first = await _seeder.SeedAsync();
        var second = await _seeder.SeedAsync();

        Assert.Equal(1, first.Updated);
        Assert.Equal(0, second.Updated);
        Assert.Equal(1, second.Skipped);
        Assert.Equal(0, second.NotFound);

        // Повторный прогон не должен переписывать текст: устаревший сид-файл
        // не затирает пример, который уже лежит в базе без изменений.
        var stored = await _context.WordLevels.SingleAsync(wl => wl.Text == "river");
        Assert.Equal("The river was deep and cold.", stored.Example);
        Assert.Equal("Река была глубокой и холодной.", stored.ExampleRu);
    }

    [Fact]
    public async Task SeedAsync_DoesNotOverwriteExistingExample()
    {
        SeedWord("river");
        _context.WordLevels.Local.Single().Example = "My own example.";
        await _context.SaveChangesAsync();
        WriteSeed("""
        [
          { "text": "river", "example": "The river was deep and cold.", "exampleRu": "Река была глубокой и холодной." }
        ]
        """);

        var result = await _seeder.SeedAsync();

        Assert.Equal(0, result.Updated);
        Assert.Equal(1, result.Skipped);
        var stored = await _context.WordLevels.SingleAsync(wl => wl.Text == "river");
        Assert.Equal("My own example.", stored.Example);
    }

    [Fact]
    public async Task SeedAsync_UnknownWordIsCountedAndDoesNotThrow()
    {
        SeedWord("river");
        await _context.SaveChangesAsync();
        WriteSeed("""
        [
          { "text": "river", "example": "The river was deep and cold.", "exampleRu": "Река была глубокой и холодной." },
          { "text": "zeppelinium", "example": "The zeppelinium arrived late.", "exampleRu": "Цеппелиниум прибыл поздно." }
        ]
        """);

        var result = await _seeder.SeedAsync();

        Assert.Equal(1, result.Updated);
        Assert.Equal(1, result.NotFound);
        // Найденное слово обновилось, несмотря на пропущенное рядом.
        var stored = await _context.WordLevels.SingleAsync(wl => wl.Text == "river");
        Assert.Equal("The river was deep and cold.", stored.Example);
    }

    [Fact]
    public async Task SeedAsync_TooLongExampleIsRejectedNotTruncated()
    {
        SeedWord("long");
        SeedWord("short");
        await _context.SaveChangesAsync();

        var tooLong = new string('a', WordExampleSeeder.MaxExampleLength + 1);
        var almostMax = new string('b', WordExampleSeeder.MaxExampleLength);
        WriteSeed($$"""
        [
          { "text": "long", "example": "{{tooLong}}", "exampleRu": "{{almostMax}}" },
          { "text": "short", "example": "That is short enough.", "exampleRu": "Этого достаточно." }
        ]
        """);

        var result = await _seeder.SeedAsync();

        // Обрезка дала бы посреди слова обрубок, который читается как ошибка
        // в предложении. Поэтому пример, не влезший в колонку, отклоняется
        // целиком и считается в Rejected.
        Assert.Equal(1, result.Rejected);
        Assert.Equal(1, result.Updated);
        var stored = await _context.WordLevels.SingleAsync(wl => wl.Text == "long");
        Assert.Null(stored.Example);
        Assert.Null(stored.ExampleRu);
        var shortWord = await _context.WordLevels.SingleAsync(wl => wl.Text == "short");
        Assert.Equal("That is short enough.", shortWord.Example);
    }

    [Fact]
    public async Task SeedAsync_MissingPairIsRejectedEntirely()
    {
        SeedWord("river");
        await _context.SaveChangesAsync();
        WriteSeed("""
        [
          { "text": "river", "example": "The river was deep and cold." }
        ]
        """);

        var result = await _seeder.SeedAsync();

        // Английский без перевода — половина карточки, которую пользователь
        // не сможет понять; пара пишется только целиком.
        Assert.Equal(1, result.Rejected);
        Assert.Equal(0, result.Updated);
        var stored = await _context.WordLevels.SingleAsync(wl => wl.Text == "river");
        Assert.Null(stored.Example);
    }

    [Fact]
    public void ParseSeed_MissingFileReportsErrorInsteadOfThrowing()
    {
        var entries = WordExampleSeeder.ParseSeed("нет-такого-файла.json", out var error);

        Assert.Empty(entries);
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Fact]
    public void RealSeedFile_ParsesAndAllTextsAreUnique()
    {
        // Настоящий сид-файл, а не заглушка: дубликат text в JSON выглядит как
        // два примера, а в базу попадёт последний — и разбираться в этом
        // придётся руками.
        // Сид-файл копируется в выход тестов (CopyToOutputDirectory в .csproj),
        // поэтому путь тот же, что у сидера относительно корня API.
        var path = Path.Combine(AppContext.BaseDirectory, WordExampleSeeder.SeedFileRelativePath);
        Assert.True(File.Exists(path), "Сид-файл не копируется в выходную папку тестов: " + path);

        var entries = WordExampleSeeder.ParseSeed(path, out var error);

        Assert.Null(error);
        Assert.NotEmpty(entries);

        var duplicates = entries
            .GroupBy(e => e.Text, StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();
        Assert.True(duplicates.Count == 0, "Повторяющиеся text: " + string.Join(", ", duplicates));

        // Ни одной строки пустой пары и ни одного примера сверх колонки.
        Assert.All(entries, entry =>
        {
            Assert.False(string.IsNullOrWhiteSpace(entry.Example));
            Assert.False(string.IsNullOrWhiteSpace(entry.ExampleRu));
            Assert.True(entry.Example.Length <= WordExampleSeeder.MaxExampleLength);
            Assert.True(entry.ExampleRu.Length <= WordExampleSeeder.MaxExampleLength);
        });

        // Пример-образец: в предложении есть само слово. Это дешёвая проверка
        // на «пример не от того слова» при массовой вставке контента.
        var типичный = entries.First(e => e.Text == "river");
        Assert.Contains("river", типичный.Example, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class FakeEnvironment : IWebHostEnvironment
    {
        public FakeEnvironment(string root)
        {
            ContentRootPath = root;
            WebRootPath = root;
            ContentRootFileProvider = new PhysicalFileProvider(root);
            WebRootFileProvider = new PhysicalFileProvider(root);
        }

        public string ApplicationName { get; set; } = "EnglishLearningPlatform.API.Tests";
        public IFileProvider WebRootFileProvider { get; set; }
        public string WebRootPath { get; set; }
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; }
        public IFileProvider ContentRootFileProvider { get; set; }
    }
}
