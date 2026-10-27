using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Hosting;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// GET /api/feedback отдаёт личные отзывы пользователей (email, контакты, тексты).
/// Доступ должен требовать отдельный Feedback:AdminKey — ключ контентных сидов
/// Seeder:Key не должен открывать переписку пользователей.
/// </summary>
public class FeedbackAdminAuthTests
{
    private static FeedbackController CreateController(
        Dictionary<string, string?> settings,
        string environmentName = "Production")
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(settings)
            .Build();

        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        context.EmailMessages.Add(new EmailMessage
        {
            To = "feedback@lexicon.local",
            Subject = "Отзыв",
            Body = "Текст отзыва",
            Kind = "feedback"
        });
        context.SaveChanges();

        var environment = new TestWebHostEnvironment { EnvironmentName = environmentName };
        var emailSender = new EmailSender(context, configuration, NullLogger<EmailSender>.Instance);
        var notifier = new FeedbackNotifier(new HttpClient(), configuration, NullLogger<FeedbackNotifier>.Instance);

        return new FeedbackController(
            emailSender,
            notifier,
            context,
            configuration,
            environment,
            NullLogger<FeedbackController>.Instance);
    }

    [Fact]
    public async Task List_SeederKey_IsRejectedWhenFeedbackKeyConfigured()
    {
        // Seeder:Key — ключ засева контента, он не должен читать личные отзывы
        var controller = CreateController(new Dictionary<string, string?>
        {
            ["Feedback:AdminKey"] = "feedback-secret",
            ["Seeder:Key"] = "seed-secret"
        });

        var result = await controller.List("seed-secret", 100, CancellationToken.None);

        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task List_SeederKey_IsForbiddenInProductionWhenFeedbackKeyMissing()
    {
        // Даже если Feedback:AdminKey не настроен, прод не должен открываться по Seeder:Key
        var controller = CreateController(new Dictionary<string, string?>
        {
            ["Seeder:Key"] = "seed-secret"
        });

        var result = await controller.List("seed-secret", 100, CancellationToken.None);

        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task List_WrongFeedbackKey_IsRejected()
    {
        var controller = CreateController(new Dictionary<string, string?>
        {
            ["Feedback:AdminKey"] = "feedback-secret"
        });

        var result = await controller.List("wrong", 100, CancellationToken.None);

        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task List_ValidFeedbackKey_ReturnsMessages()
    {
        var controller = CreateController(new Dictionary<string, string?>
        {
            ["Feedback:AdminKey"] = "feedback-secret"
        });

        var result = await controller.List("feedback-secret", 100, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(ok.Value);
    }
}
