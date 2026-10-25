using EnglishLearningPlatform.API.Services.Reader;

namespace EnglishLearningPlatform.API.Tests.Reader;

public class SentenceSplitterTests
{
    [Fact]
    public void Split_KeepsAbbreviationsInsideSentence()
    {
        var result = SentenceSplitter.Split("Mr. Smith went home. Dr. Jones stayed.");

        Assert.Equal(new[] { "Mr. Smith went home.", "Dr. Jones stayed." }, result);
    }

    [Fact]
    public void Split_KeepsInitialsAndDecimals()
    {
        var result = SentenceSplitter.Split("The U.S.A. is large. It cost 3.14 dollars.");

        Assert.Equal(new[] { "The U.S.A. is large.", "It cost 3.14 dollars." }, result);
    }

    [Fact]
    public void Split_KeepsClosingQuoteWithSentence()
    {
        var result = SentenceSplitter.Split("She said, \"Hello.\" Then she left.");

        Assert.Equal(new[] { "She said, \"Hello.\"", "Then she left." }, result);
    }

    [Fact]
    public void Split_HandlesEllipsisWithoutBreakingIntoFragments()
    {
        var result = SentenceSplitter.Split("Wait... What?");

        Assert.Equal(new[] { "Wait...", "What?" }, result);
    }

    [Fact]
    public void Split_DoesNotCutDotWithoutSpace()
    {
        var result = SentenceSplitter.Split("No space.after dot");

        Assert.Equal(new[] { "No space.after dot" }, result);
    }

    [Fact]
    public void Split_KeepsTailWithoutTerminalPunctuation()
    {
        var result = SentenceSplitter.Split("First. Second without end");

        Assert.Equal(new[] { "First.", "Second without end" }, result);
    }

    [Fact]
    public void Split_EmptyTextReturnsEmptyList()
    {
        Assert.Empty(SentenceSplitter.Split(""));
        Assert.Empty(SentenceSplitter.Split("   "));
        Assert.Empty(SentenceSplitter.Split(null));
    }
}
