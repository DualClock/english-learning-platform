using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

public class SrsDefinitionFilterTests
{
    private static (ApplicationDbContext Context, SrsService Service) CreateFixture()
    {
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        return (context, new SrsService(context, cache));
    }

    [Fact]
    public async Task TodayQueue_WaitsForTranslationBeforeShowingWord()
    {
        var fixture = CreateFixture();
        await using var context = fixture.Context;
        var service = fixture.Service;
        var now = DateTime.UtcNow;

        var translatedDue = new Word { Text = "listen" };
        translatedDue.Definitions.Add(new WordDefinition { Definition = "слушать" });
        var untranslatedDue = new Word { Text = "whisper" };
        var translatedNew = new Word { Text = "silence" };
        translatedNew.Definitions.Add(new WordDefinition { Definition = "тишина" });
        var untranslatedNew = new Word { Text = "answer" };

        context.UserWords.AddRange(
            new UserWord
            {
                UserId = "user-a",
                Word = translatedDue,
                LastReviewedAt = now.AddDays(-3),
                NextReviewDate = now.AddDays(-1)
            },
            new UserWord
            {
                UserId = "user-a",
                Word = untranslatedDue,
                LastReviewedAt = now.AddDays(-3),
                NextReviewDate = now.AddDays(-1)
            },
            new UserWord
            {
                UserId = "user-a",
                Word = translatedNew,
                NextReviewDate = now
            },
            new UserWord
            {
                UserId = "user-a",
                Word = untranslatedNew,
                NextReviewDate = now
            });
        await context.SaveChangesAsync();

        var queue = await service.GetTodayQueueAsync("user-a", newLimit: 10);
        var dueCount = await service.GetReviewCountAsync("user-a");

        Assert.Equal("listen", Assert.Single(queue.DueWords).Word.Text);
        Assert.Equal("silence", Assert.Single(queue.NewWords).Word.Text);
        Assert.Equal(1, queue.DueCount);
        Assert.Equal(1, queue.NewCount);
        Assert.Equal(1, dueCount);
    }

    [Fact]
    public async Task Reminder_DoesNotPromiseReviewOfUntranslatedWords()
    {
        var fixture = CreateFixture();
        await using var context = fixture.Context;
        var now = DateTime.UtcNow;

        var translatedDue = new Word { Text = "listen" };
        translatedDue.Definitions.Add(new WordDefinition { Definition = "слушать" });
        var untranslatedDue = new Word { Text = "whisper" };
        var translatedNew = new Word { Text = "silence" };
        translatedNew.Definitions.Add(new WordDefinition { Definition = "тишина" });
        var untranslatedNew = new Word { Text = "answer" };

        context.UserWords.AddRange(
            new UserWord
            {
                UserId = "user-a",
                Word = translatedDue,
                LastReviewedAt = now.AddDays(-3),
                NextReviewDate = now.AddDays(-1)
            },
            new UserWord
            {
                UserId = "user-a",
                Word = untranslatedDue,
                LastReviewedAt = now.AddDays(-3),
                NextReviewDate = now.AddDays(-1)
            },
            new UserWord { UserId = "user-a", Word = translatedNew, NextReviewDate = now },
            new UserWord { UserId = "user-a", Word = untranslatedNew, NextReviewDate = now });
        await context.SaveChangesAsync();

        var configuration = new ConfigurationBuilder().Build();
        var service = new ReminderService(
            context,
            email: null!,
            configuration,
            NullLogger<ReminderService>.Instance);

        var content = await service.BuildAsync(
            new User
            {
                Id = "user-a",
                Email = "user-a@example.com",
                DisplayName = "Тест",
                TotalXp = 0,
            },
            DateTime.UtcNow,
            weekly: false);

        Assert.NotNull(content);
        Assert.StartsWith("Пора повторить 1 слово", content!.Subject);
        Assert.Contains("Ещё новых слов в очереди: 1.", content.Body);
    }
}
