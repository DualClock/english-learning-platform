using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests;

public class WordVisualizationTests
{
    [Fact]
    public void Emoji_IsAllowedOnlyFromCatalog()
    {
        Assert.True(WordVisualCatalog.IsAllowedEmoji("🍎"));
        Assert.False(WordVisualCatalog.IsAllowedEmoji("hello"));
        Assert.False(WordVisualCatalog.IsAllowedEmoji(""));
        Assert.False(WordVisualCatalog.IsAllowedEmoji(null));
    }

    [Fact]
    public async Task VisualBelongsToOneUser_AndImageAndEmojiAreExclusive()
    {
        await using var context = CreateSharedContext(out var wordId);
        var service = new DictionaryService(context);

        var (a, removed) = await service.SetEmojiAsync("user-a", wordId, "🍎");
        Assert.NotNull(a);
        Assert.Equal("🍎", a!.Emoji);
        Assert.Null(a.ImageUrl);
        Assert.Null(removed);

        var (withImage, removedEmoji) = await service.SetImageAsync(
            "user-a",
            wordId,
            "/uploads/word-images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png");
        Assert.NotNull(withImage);
        Assert.Null(withImage!.Emoji);
        Assert.EndsWith(".png", withImage.ImageUrl);
        Assert.Null(removedEmoji);

        var (itemsA, _) = await service.GetUserWordsAsync("user-a", 1, 10);
        var (itemsB, _) = await service.GetUserWordsAsync("user-b", 1, 10);
        Assert.Equal(withImage.ImageUrl, Assert.Single(itemsA).ImageUrl);
        Assert.Null(Assert.Single(itemsB).Emoji);
        Assert.Null(Assert.Single(itemsB).ImageUrl);

        var (cleared, removedImage) = await service.ClearVisualAsync("user-a", wordId);
        Assert.True(cleared);
        Assert.Equal(withImage.ImageUrl, removedImage);

        var (afterClear, _) = await service.GetUserWordsAsync("user-a", 1, 10);
        Assert.Null(Assert.Single(afterClear).Emoji);
        Assert.Null(Assert.Single(afterClear).ImageUrl);
    }

    private static ApplicationDbContext CreateSharedContext(out int wordId)
    {
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        var word = new Word { Text = "apple", Language = "en" };
        word.Definitions.Add(new WordDefinition { Definition = "яблоко" });
        context.Words.Add(word);
        context.UserWords.Add(new UserWord { UserId = "user-a", Word = word });
        context.UserWords.Add(new UserWord { UserId = "user-b", Word = word });
        context.SaveChanges();
        wordId = word.Id;
        return context;
    }
}
