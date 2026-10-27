using System.Xml.Linq;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

public class StorySeederCoverTests : IDisposable
{
    private readonly string _root;
    private readonly StorySeeder _seeder;

    public StorySeederCoverTests()
    {
        _root = Path.Combine(AppContext.BaseDirectory, "elp-covers-" + Guid.NewGuid().ToString("N"));
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("covers-" + Guid.NewGuid().ToString("N"))
            .Options;

        _seeder = new StorySeeder(
            new ApplicationDbContext(options),
            new FakeEnvironment(_root),
            NullLogger<StorySeeder>.Instance);
    }

    [Fact]
    public void GetCoverSvg_ReturnsValidSvg_WithEscapedTitle()
    {
        var story = new StorySeedData
        {
            Title = "The <Lost> Kitten & \"Friends\"",
            Author = "Lexicon Stories"
        };

        var svg = _seeder.GetCoverSvg(0, story);
        var doc = XDocument.Parse(svg);

        Assert.Equal("svg", doc.Root!.Name.LocalName);
        Assert.Equal("400", doc.Root.Attribute("width")!.Value);
        Assert.Equal("600", doc.Root.Attribute("height")!.Value);

        // Спецсимволы названия экранированы — сырых угловых скобок в тексте нет
        Assert.Contains("The &lt;Lost&gt; Kitten", svg);
        Assert.Contains("&amp; &quot;Friends&quot;", svg);
        Assert.DoesNotContain("<Lost>", svg);
        Assert.Contains("Lexicon Stories", svg);
        // Декоративные элементы: градиент, рамка, ✦
        Assert.Contains("linearGradient", svg);
        Assert.Contains("&#10022;", svg);
    }

    [Fact]
    public void GetCoverSvg_DifferentIndexes_UseDifferentGradients()
    {
        var story = new StorySeedData { Title = "The Photograph", Author = "Lexicon Stories" };

        var first = _seeder.GetCoverSvg(0, story);
        var second = _seeder.GetCoverSvg(1, story);

        Assert.NotEqual(first, second);
    }

    [Fact]
    public void GetCoverSvg_LongTitle_WrapsToLimitedLines()
    {
        var story = new StorySeedData
        {
            Title = "The Remarkable Adventures Of The Extraordinary Little Fox Who Wandered Far Beyond The Hills",
            Author = "Lexicon Stories"
        };

        var svg = _seeder.GetCoverSvg(0, story);
        XDocument.Parse(svg); // не падает по XML

        var titleLines = svg.Split('\n').Count(l => l.Contains("font-weight=\"bold\""));
        Assert.True(titleLines <= 4, $"Expected <= 4 title lines, got {titleLines}");
        Assert.Contains("…", svg);
    }

    [Fact]
    public void EnsureCoverUrl_WritesSvgFile_AndReturnsStablePath()
    {
        var story = new StorySeedData { Title = "The Winter Fox", Author = "Lexicon Stories" };

        var url = _seeder.EnsureCoverUrl(2, story);

        Assert.Equal("/uploads/covers/story-2.svg", url);

        var filePath = Path.Combine(_root, "uploads", "covers", "story-2.svg");
        Assert.True(File.Exists(filePath));
        Assert.Contains("<svg", File.ReadAllText(filePath));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private sealed class FakeEnvironment : IWebHostEnvironment
    {
        public FakeEnvironment(string contentRootPath)
        {
            ContentRootPath = contentRootPath;
        }

        public string ApplicationName { get; set; } = "test";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string EnvironmentName { get; set; } = "Development";
        public string WebRootName { get; set; } = "wwwroot";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = "";
        public string ContentRootPath { get; set; } = "";
    }
}
