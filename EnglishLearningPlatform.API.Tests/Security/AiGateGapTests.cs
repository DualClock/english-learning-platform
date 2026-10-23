using System.Reflection;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Security;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// W1.4.3: дыра, которую пропустил фикс 1b1c8c9.
///
/// Email-гейт поставили на четыре контроллера по захардкоженному списку, и
/// `GET /api/books/{id}/parallel` в него не попал — хотя этот экшен одним
/// литературным вызовом Gemini переводит всю страницу книги. Пока «список
/// AI-эндпоинтов» живёт в голове у того, кто пишет патч, каждый новый эндпоинт
/// с доступом к модели рискует остаться без гейта — ровно как здесь.
/// </summary>
public class AiGateGapTests
{
    [Fact]
    public void BooksController_ParallelPage_IsGatedOnConfirmedEmail()
    {
        var action = typeof(BooksController).GetMethod(
            nameof(BooksController.GetParallelPage),
            BindingFlags.Instance | BindingFlags.Public);

        Assert.NotNull(action);

        var onAction = action!.GetCustomAttributes(typeof(RequireConfirmedEmailAttribute), inherit: true);
        var onController = typeof(BooksController).GetCustomAttributes(typeof(RequireConfirmedEmailAttribute), inherit: true);

        Assert.True(
            onAction.Length > 0 || onController.Length > 0,
            "GET /api/books/{id}/parallel вызывает AiService.TranslateLiteraryAsync (Gemini) и доступен аккаунтам с неподтверждённым email");
    }
}
