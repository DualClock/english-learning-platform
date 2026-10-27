using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests;

public class AchievementP2Tests
{
    [Fact]
    public async Task FirstUntranslatedWordAndBulkSet_UnlockFromRealMetrics()
    {
        await using var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        context.Users.Add(new User
        {
            Id = "user-a",
            UserName = "user-a@example.com",
            NormalizedUserName = "USER-A@EXAMPLE.COM",
            Email = "user-a@example.com",
            NormalizedEmail = "USER-A@EXAMPLE.COM"
        });

        var untranslated = new Word { Text = "listen" };
        context.UserWords.Add(new UserWord
        {
            UserId = "user-a",
            Word = untranslated,
            Source = "manual"
        });

        for (var index = 0; index < 5; index++)
        {
            var word = new Word { Text = $"bulk{index}" };
            word.Definitions.Add(new WordDefinition { Definition = $"пачка {index}" });
            context.UserWords.Add(new UserWord
            {
                UserId = "user-a",
                Word = word,
                Source = "bulk"
            });
        }
        await context.SaveChangesAsync();

        var progress = await new AchievementService(context).GetProgressAsync("user-a");

        Assert.Equal(1, progress.Metrics.UntranslatedWords);
        Assert.Equal(5, progress.Metrics.BulkWords);
        Assert.Contains(progress.Achievements, item => item.Code == "first_untranslated" && item.Unlocked);
        Assert.Contains(progress.Achievements, item => item.Code == "bulk_5" && item.Unlocked);
    }
}
