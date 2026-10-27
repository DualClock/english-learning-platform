using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests;

public class DictionaryContextTests
{
    private static ApplicationDbContext CreateContext()
    {
        return new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
    }

    [Fact]
    public async Task AddWord_ReturnsSourceAndContextForDictionaryCard()
    {
        await using var context = CreateContext();
        var service = new DictionaryService(context);

        var created = await service.AddWordAsync(
            "user-a",
            new AddWordRequest(
                "listen",
                Definition: null,
                PartOfSpeech: null,
                Example: null,
                Source: "reader",
                Context: "Listen carefully."),
            source: "reader");

        Assert.NotNull(created);
        Assert.Equal("reader", ReadProperty<string>(created!, "Source"));
        Assert.Equal("Listen carefully.", ReadProperty<string>(created!, "Context"));
    }

    [Fact]
    public async Task GetUserWords_ReturnsSourceAndLatestContext()
    {
        await using var context = CreateContext();
        var service = new DictionaryService(context);

        await service.AddWordAsync(
            "user-a",
            new AddWordRequest(
                "listen",
                Definition: "слушать",
                PartOfSpeech: null,
                Example: null,
                Source: "reader",
                Context: "Listen carefully."),
            source: "reader");

        var (items, _) = await service.GetUserWordsAsync("user-a", 1, 50);

        var word = Assert.Single(items);
        Assert.Equal("reader", ReadProperty<string>(word, "Source"));
        Assert.Equal("Listen carefully.", ReadProperty<string>(word, "Context"));
    }

    [Fact]
    public async Task GetUserWords_ReturnsCategoryIconForVisualFallback()
    {
        await using var context = CreateContext();
        var word = new Word { Text = "apple", Language = "en" };
        word.Definitions.Add(new WordDefinition { Definition = "яблоко" });
        context.Categories.Add(new Category
        {
            Name = "Еда",
            Slug = "food",
            Icon = "🍎",
            Words = { new CategoryWord { English = "apple", Translation = "яблоко" } }
        });
        context.UserWords.Add(new UserWord { UserId = "user-a", Word = word });
        await context.SaveChangesAsync();

        var service = new DictionaryService(context);
        var (items, _) = await service.GetUserWordsAsync("user-a", 1, 10);

        Assert.Equal("🍎", ReadProperty<string>(Assert.Single(items), "CategoryIcon"));
    }

    private static T? ReadProperty<T>(object value, string name)
    {
        var property = value.GetType().GetProperty(name);
        return property == null ? default : (T?)property.GetValue(value);
    }
}
