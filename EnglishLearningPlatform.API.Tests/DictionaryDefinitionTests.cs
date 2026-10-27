using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests;

public class DictionaryDefinitionTests
{
    private static ApplicationDbContext CreateContext()
    {
        return new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
    }

    private static AddWordRequest Request(string text, string? definition) =>
        new(text, definition, PartOfSpeech: null, Example: null, Source: "manual", Context: null);

    [Fact]
    public async Task AddWord_WithoutDefinition_SavesWordForReview()
    {
        await using var context = CreateContext();
        var service = new DictionaryService(context);

        var created = await service.AddWordAsync("user-a", Request("listen", null));

        Assert.NotNull(created);
        Assert.Equal("listen", created!.Text);
        Assert.Empty(created.Definitions);

        var stored = await context.UserWords
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .SingleAsync(uw => uw.UserId == "user-a");

        Assert.Equal("listen", stored.Word.Text);
        Assert.Empty(stored.Word.Definitions);
        Assert.NotNull(stored.NextReviewDate);
    }

    [Fact]
    public async Task AddWord_WithoutDefinition_StillKeepsContextAndSource()
    {
        await using var context = CreateContext();
        var service = new DictionaryService(context);

        await service.AddWordAsync(
            "user-a",
            new AddWordRequest(
                "listen",
                Definition: null,
                PartOfSpeech: null,
                Example: null,
                Source: "reader",
                Context: "Listen carefully, the answer is in the silence."),
            source: "reader");

        var interaction = await context.Interactions.SingleAsync(i => i.UserId == "user-a");
        Assert.Equal("reader", interaction.Source);
        Assert.Equal("Listen carefully, the answer is in the silence.", interaction.ContextSentence);
    }

    [Fact]
    public async Task AddWords_BatchWithoutTranslations_DoesNotCreateBlankDefinitions()
    {
        await using var context = CreateContext();
        var service = new DictionaryService(context);

        var added = await service.AddWordsAsync(
            "user-a",
            new[]
            {
                ("whisper", string.Empty),
                ("listen", "   ")
            },
            source: "reader");

        Assert.Equal(2, added);
        Assert.All(
            await context.Words.Include(w => w.Definitions).ToListAsync(),
            word => Assert.Empty(word.Definitions));
    }

    [Fact]
    public async Task AddWord_ExistingWordWithoutDefinition_AcceptsFirstTranslation()
    {
        await using var context = CreateContext();
        context.Words.Add(new Word { Text = "listen", Language = "en" });
        await context.SaveChangesAsync();

        var service = new DictionaryService(context);
        var created = await service.AddWordAsync(
            "user-a",
            Request("listen", "слушать"));

        Assert.NotNull(created);
        var definition = Assert.Single(created!.Definitions);
        Assert.Equal("слушать", definition.Definition);
    }

    [Fact]
    public async Task UpdateWord_WithoutDefinition_CanAddTranslationLater()
    {
        await using var context = CreateContext();
        var word = new Word { Text = "listen", Language = "en" };
        context.Words.Add(word);
        context.UserWords.Add(new UserWord
        {
            UserId = "user-a",
            Word = word,
            NextReviewDate = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var service = new DictionaryService(context);
        var updated = await service.UpdateWordAsync(
            "user-a",
            word.Id,
            new UpdateWordRequest(Text: null, Definition: "слушать", PartOfSpeech: null, Example: null));

        Assert.NotNull(updated);
        var definition = Assert.Single(updated!.Definitions);
        Assert.Equal("слушать", definition.Definition);

        var stored = await context.Words.Include(w => w.Definitions).SingleAsync(w => w.Id == word.Id);
        Assert.Single(stored.Definitions);
    }
}
