using EnglishLearningPlatform.API.Services.Reader;

namespace EnglishLearningPlatform.API.Tests.Reader;

public class BookSnapshotParserTests
{
    [Fact]
    public async Task Parse_BuildsStructuredBlocksAndImage()
    {
        using var test = ReaderTestContext.Create();
        var snapshot = await test.Parser.ParseAsync(test.BookPath, test.Hash);

        Assert.Equal(2, snapshot.Chapters.Count);
        Assert.Equal("Chapter One", snapshot.Chapters[0].Title);
        Assert.Equal("Chapter Two", snapshot.Chapters[1].Title);
        Assert.True(snapshot.WordCount > 20);

        var blocks = snapshot.Chapters[0].Blocks;
        Assert.Contains(blocks, b => b.Type == ReaderBlockTypes.Heading);
        Assert.Contains(blocks, b => b.Type == ReaderBlockTypes.Quote);
        Assert.Contains(blocks, b => b.Type == ReaderBlockTypes.Image);
        Assert.Contains(blocks, b => b.Type == ReaderBlockTypes.Verse);
        Assert.Contains(blocks, b => b.Type == ReaderBlockTypes.ListItem);

        var image = blocks.Single(b => b.Type == ReaderBlockTypes.Image);
        Assert.False(string.IsNullOrWhiteSpace(image.Asset));
        Assert.Equal(10, image.Width);
        Assert.Equal(10, image.Height);
        Assert.Equal("A tiny image", image.Caption);
        Assert.True(File.Exists(Path.Combine(test.Environment.ContentRootPath, "uploads", "book-assets", test.Hash, image.Asset!)));

        var allText = string.Join(" ", snapshot.Chapters
            .SelectMany(c => c.Blocks)
            .SelectMany(b => b.Sentences)
            .Select(s => s.Text));
        Assert.DoesNotContain("<script", allText);
        Assert.DoesNotContain("alert", allText);
        Assert.DoesNotContain("<p>", allText);
        Assert.Contains("Mr. Smith walked to the river.", allText);
        Assert.Contains("No space.after dot.", allText);
    }

    [Fact]
    public async Task Parse_IsDeterministic()
    {
        using var test = ReaderTestContext.Create();
        var first = await test.Parser.ParseAsync(test.BookPath, test.Hash);
        var second = await test.Parser.ParseAsync(test.BookPath, test.Hash);

        Assert.Equal(
            first.Chapters.Select(c => c.Id),
            second.Chapters.Select(c => c.Id));
        Assert.Equal(
            first.Chapters.SelectMany(c => c.Blocks).SelectMany(b => b.Sentences).Select(s => s.Id),
            second.Chapters.SelectMany(c => c.Blocks).SelectMany(b => b.Sentences).Select(s => s.Id));
        Assert.Equal(first.WordCount, second.WordCount);
    }

    [Fact]
    public async Task Parse_WordStartsAreMonotonicAcrossChapters()
    {
        using var test = ReaderTestContext.Create();
        var snapshot = await test.Parser.ParseAsync(test.BookPath, test.Hash);

        var sentences = snapshot.Chapters.SelectMany(c => c.Blocks).SelectMany(b => b.Sentences).ToList();
        var previous = -1;
        foreach (var sentence in sentences)
        {
            Assert.True(sentence.WordStart >= previous, $"WordStart went backwards at {sentence.Id}");
            Assert.True(sentence.WordCount > 0);
            previous = sentence.WordStart + sentence.WordCount;
        }

        Assert.Equal(snapshot.WordCount, previous);
        Assert.Equal(
            snapshot.Chapters[0].WordStart + snapshot.Chapters[0].WordCount,
            snapshot.Chapters[1].WordStart);
    }

    [Fact]
    public async Task Parse_StripsGutenbergMarkers()
    {
        using var test = ReaderTestContext.Create(gutenbergMarkers: true);
        var snapshot = await test.Parser.ParseAsync(test.BookPath, test.Hash);
        var allText = string.Join(" ", snapshot.Chapters
            .SelectMany(c => c.Blocks)
            .SelectMany(b => b.Sentences)
            .Select(s => s.Text));

        Assert.DoesNotContain("START OF THE PROJECT GUTENBERG", allText);
        Assert.DoesNotContain("END OF THE PROJECT GUTENBERG", allText);
        Assert.DoesNotContain("License junk", allText);
        Assert.DoesNotContain("Footer junk", allText);
        Assert.Contains("Mr. Smith walked to the river.", allText);
        Assert.Contains("They walked home.", allText);
    }
}
