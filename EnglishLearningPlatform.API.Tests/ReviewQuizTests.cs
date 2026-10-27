using System.Security.Claims;
using System.Text.Json;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Tests;

public class ReviewQuizTests
{
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    private static ReviewController CreateController(
        ApplicationDbContext context,
        string userId,
        IMemoryCache? cache = null)
    {
        cache ??= new MemoryCache(new MemoryCacheOptions());
        return new ReviewController(
            new SrsService(context, cache),
            context,
            new ActivityService(context),
            cache)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, userId) },
                        authenticationType: "test"))
                }
            }
        };
    }

    [Fact]
    public async Task GetQuiz_IgnoresWordsWithoutTranslation()
    {
        await using var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        var translations = new[]
        {
            ("listen", "слушать"),
            ("whisper", "шептать"),
            ("silence", "тишина"),
            ("answer", "ответ")
        };

        foreach (var (text, definition) in translations)
        {
            var word = new Word { Text = text, Language = "en" };
            word.Definitions.Add(new WordDefinition { Definition = definition });
            context.UserWords.Add(new UserWord
            {
                UserId = "user-a",
                Word = word,
                NextReviewDate = DateTime.UtcNow
            });
        }

        var untranslated = new Word { Text = "listen" };
        context.UserWords.Add(new UserWord
        {
            UserId = "user-a",
            Word = untranslated,
            NextReviewDate = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var controller = CreateController(context, "user-a");
        var response = await controller.GetQuiz(10);

        var ok = Assert.IsType<OkObjectResult>(response.Result);
        var json = JsonSerializer.Serialize(ok.Value, WebJson);
        using var document = JsonDocument.Parse(json);

        var questions = document.RootElement.GetProperty("questions");
        Assert.Equal(4, questions.GetArrayLength());
        Assert.All(
            questions.EnumerateArray(),
            question =>
            {
                var options = question.GetProperty("options");
                Assert.Equal(4, options.GetArrayLength());
                Assert.All(
                    options.EnumerateArray(),
                    option => Assert.False(string.IsNullOrWhiteSpace(option.GetString())));

                var correctIndex = question.GetProperty("correctIndex").GetInt32();
                Assert.InRange(correctIndex, 0, 3);
            });

        Assert.False(string.IsNullOrWhiteSpace(document.RootElement.GetProperty("quizToken").GetString()));
    }

    [Fact]
    public async Task GetQuiz_PrefersDistractorsFromSameCefrLevel()
    {
        await using var context = CreateContext();
        var words = new[]
        {
            ("listen", "слушать", "b1"),
            ("whisper", "шептать", "b1"),
            ("silence", "тишина", "b1"),
            ("answer", "ответ", "b1"),
            ("apple", "яблоко", "a1"),
            ("house", "дом", "a1"),
            ("water", "вода", "a1"),
            ("book", "книга", "a1"),
        };

        var levelByDefinition = new Dictionary<string, string>();
        foreach (var (text, definition, level) in words)
        {
            var word = new Word { Text = text, Language = "en" };
            word.Definitions.Add(new WordDefinition { Definition = definition });
            context.UserWords.Add(new UserWord
            {
                UserId = "user-a",
                Word = word,
                NextReviewDate = DateTime.UtcNow
            });
            context.WordLevels.Add(new WordLevel
            {
                Text = text,
                CefrLevel = level,
                TranslationRu = definition
            });
            levelByDefinition[definition] = level;
        }
        await context.SaveChangesAsync();

        var controller = CreateController(context, "user-a");
        var response = await controller.GetQuiz(10);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value, WebJson));
        var questions = document.RootElement.GetProperty("questions");

        Assert.Equal(8, questions.GetArrayLength());

        var wordLevelByText = words.ToDictionary(item => item.Item1, item => item.Item3);
        foreach (var question in questions.EnumerateArray())
        {
            var text = question.GetProperty("text").GetString()!;
            var expectedLevel = wordLevelByText[text];
            var options = question.GetProperty("options").EnumerateArray()
                .Select(option => option.GetString()!)
                .ToList();

            Assert.Equal(4, options.Count);
            Assert.All(options, option => Assert.Equal(expectedLevel, levelByDefinition[option]));
            Assert.Equal(4, options.Distinct().Count());
        }
    }

    [Fact]
    public async Task QuizResult_IsSavedOnceAndAwardsXp()
    {
        // ActivityService использует атомарный ExecuteUpdate, которого нет
        // в InMemory-провайдере. Проверяем весь путь на настоящем SQL.
        await using var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();
        await using var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseSqlite(connection)
                .Options);
        await context.Database.EnsureCreatedAsync();

        context.Users.Add(new User
        {
            Id = "user-a",
            UserName = "user-a@example.com",
            NormalizedUserName = "USER-A@EXAMPLE.COM",
            Email = "user-a@example.com",
            NormalizedEmail = "USER-A@EXAMPLE.COM",
            TotalXp = 0
        });

        foreach (var (text, definition) in new[]
                 {
                     ("listen", "слушать"),
                     ("whisper", "шептать"),
                     ("silence", "тишина"),
                     ("answer", "ответ")
                 })
        {
            var word = new Word { Text = text, Language = "en" };
            word.Definitions.Add(new WordDefinition { Definition = definition });
            context.UserWords.Add(new UserWord
            {
                UserId = "user-a",
                Word = word,
                NextReviewDate = DateTime.UtcNow
            });
        }
        await context.SaveChangesAsync();

        var cache = new MemoryCache(new MemoryCacheOptions());
        var controller = CreateController(context, "user-a", cache);

        var quizResponse = await controller.GetQuiz(10);
        var quizOk = Assert.IsType<OkObjectResult>(quizResponse.Result);
        using var quizDocument = JsonDocument.Parse(JsonSerializer.Serialize(quizOk.Value, WebJson));
        var token = quizDocument.RootElement.GetProperty("quizToken").GetString()!;
        var total = quizDocument.RootElement.GetProperty("questions").GetArrayLength();

        var result = await controller.SaveQuizResult(
            new QuizResultRequest(token, Correct: total, Mode: "listening"));

        var resultOk = Assert.IsType<OkObjectResult>(result);
        using var resultDocument = JsonDocument.Parse(JsonSerializer.Serialize(resultOk.Value, WebJson));
        Assert.Equal(3, resultDocument.RootElement.GetProperty("xpEarned").GetInt32());

        var activity = await context.DailyActivities.SingleAsync(a => a.UserId == "user-a");
        Assert.Equal(1, activity.QuizzesDone);
        Assert.Equal(3, await context.XpEvents.SumAsync(e => e.Xp));
        var analytics = await context.AnalyticsEvents.SingleAsync(e => e.UserId == "user-a");
        Assert.Equal("quiz_finished", analytics.Event);
        Assert.Contains("listening", analytics.Meta);

        var second = await controller.SaveQuizResult(
            new QuizResultRequest(token, Correct: total, Mode: "listening"));
        Assert.IsType<ConflictObjectResult>(second);
        Assert.Equal(3, await context.XpEvents.SumAsync(e => e.Xp));
    }

    [Fact]
    public async Task QuizHistory_ReturnsLatestSavedAttemptsNewestFirst()
    {
        await using var context = CreateContext();
        context.AnalyticsEvents.AddRange(
            new AnalyticsEvent
            {
                UserId = "user-a",
                Event = "quiz_finished",
                Meta = """{"mode":"reading","correct":6,"total":10}""",
                CreatedAt = DateTime.UtcNow.AddHours(-2)
            },
            new AnalyticsEvent
            {
                UserId = "user-a",
                Event = "quiz_finished",
                Meta = """{"mode":"listening","correct":9,"total":10}""",
                CreatedAt = DateTime.UtcNow.AddHours(-1)
            },
            new AnalyticsEvent
            {
                UserId = "user-b",
                Event = "quiz_finished",
                Meta = """{"mode":"listening","correct":1,"total":10}""",
                CreatedAt = DateTime.UtcNow
            });
        await context.SaveChangesAsync();

        var controller = CreateController(context, "user-a");
        var response = await controller.GetQuizHistory(5);

        var ok = Assert.IsType<OkObjectResult>(response);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value, WebJson));
        var items = document.RootElement.GetProperty("items");
        Assert.Equal(2, items.GetArrayLength());

        var first = items[0];
        Assert.Equal("listening", first.GetProperty("mode").GetString());
        Assert.Equal(9, first.GetProperty("correct").GetInt32());
        Assert.Equal(10, first.GetProperty("total").GetInt32());

        var second = items[1];
        Assert.Equal("reading", second.GetProperty("mode").GetString());
        Assert.Equal(6, second.GetProperty("correct").GetInt32());
    }

    private static ApplicationDbContext CreateContext()
    {
        return new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
    }
}
