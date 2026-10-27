using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// Слова в таблице Words общие для всех пользователей. Раньше правка слова
/// одним пользователем меняла перевод и у всех остальных. Теперь для общего
/// слова создаётся личная копия (copy-on-write).
/// </summary>
public class SharedWordMutationTests
{
    private sealed record Fixture(ApplicationDbContext Context, DictionaryService Service, int WordId);

    private static Fixture CreateSharedWord()
    {
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        var word = new Word { Text = "hello", Language = "en" };
        word.Definitions.Add(new WordDefinition { Definition = "привет", DisplayOrder = 0 });
        context.Words.Add(word);

        context.UserWords.Add(new UserWord { UserId = "user-a", Word = word, NextReviewDate = DateTime.UtcNow });
        context.UserWords.Add(new UserWord { UserId = "user-b", Word = word, NextReviewDate = DateTime.UtcNow });
        context.SaveChanges();

        return new Fixture(context, new DictionaryService(context), word.Id);
    }

    [Fact]
    public async Task UpdateWord_SharedWord_DoesNotChangeOtherUsersDefinition()
    {
        var fixture = CreateSharedWord();

        var updated = await fixture.Service.UpdateWordAsync(
            "user-a",
            fixture.WordId,
            new UpdateWordRequest(Text: null, Definition: "здравствуйте", PartOfSpeech: null, Example: null));

        Assert.NotNull(updated);
        Assert.Equal("здравствуйте", updated!.Definitions.First().Definition);

        var wordA = await fixture.Context.UserWords
            .Include(uw => uw.Word).ThenInclude(w => w.Definitions)
            .FirstAsync(uw => uw.UserId == "user-a");
        var wordB = await fixture.Context.UserWords
            .Include(uw => uw.Word).ThenInclude(w => w.Definitions)
            .FirstAsync(uw => uw.UserId == "user-b");

        Assert.Equal("здравствуйте", wordA.Word.Definitions.First().Definition);
        Assert.Equal("привет", wordB.Word.Definitions.First().Definition);
        Assert.NotEqual(wordA.WordId, wordB.WordId);
    }

    [Fact]
    public async Task UpdateWord_SoleOwner_UpdatesInPlace()
    {
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        var word = new Word { Text = "solo", Language = "en" };
        word.Definitions.Add(new WordDefinition { Definition = "один", DisplayOrder = 0 });
        context.Words.Add(word);
        context.UserWords.Add(new UserWord { UserId = "user-a", Word = word, NextReviewDate = DateTime.UtcNow });
        context.SaveChanges();

        var service = new DictionaryService(context);
        var updated = await service.UpdateWordAsync(
            "user-a",
            word.Id,
            new UpdateWordRequest(Text: null, Definition: "единственный", PartOfSpeech: null, Example: null));

        Assert.NotNull(updated);
        Assert.Equal(word.Id, updated!.Id);
        Assert.Equal("единственный", updated.Definitions.First().Definition);

        var stored = await context.UserWords.Include(uw => uw.Word).ThenInclude(w => w.Definitions)
            .FirstAsync(uw => uw.UserId == "user-a");
        Assert.Equal(word.Id, stored.WordId);
    }
}
