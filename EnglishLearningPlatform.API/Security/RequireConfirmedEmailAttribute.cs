using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;

namespace EnglishLearningPlatform.API.Security;

// Контракт отказа для неподтверждённого email (SECURITY_GATE 1.5).
public sealed record EmailConfirmationRequiredResult(string Error, string Message);

/// <summary>
/// A6: каждый AI-запрос — реальные деньги (Gemini), а регистрация открыта.
/// Без подтверждения email disposable-аккаунты выжигают бюджет и SMTP-лимиты.
/// Доступ к AI-эндпоинтам — только EmailConfirmed == true; проверка по БД,
/// а не по claim в токене, чтобы подтверждение из письма действовало сразу.
///
/// Флаг <c>Auth:RequireConfirmedEmail</c> (по умолчанию включён) выключает саму
/// проверку, но не убирает атрибут с эндпоинтов: почтовые транспорты недоступны
/// из региона и с этого VPS (SMTP-порты режет хостер, SMTP-хосты Google и Яндекса
/// не отвечают), и требование подтверждения превращало все ИИ-функции в 403 для
/// каждого нового аккаунта. Обратное включение — одна строка конфига, тест
/// <c>AiEndpointGateTests</c> продолжает требовать наличие гейта.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequireConfirmedEmailAttribute : ActionFilterAttribute
{
    public const string ConfigKey = "Auth:RequireConfirmedEmail";

    public override async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        // GetService, а не GetRequiredService: отсутствие IConfiguration означает, что
        // мы не в реальном приложении, и безопаснее считать требование включённым.
        var configuration = context.HttpContext.RequestServices.GetService<IConfiguration>();

        if (configuration is not null && !configuration.GetValue(ConfigKey, defaultValue: true))
        {
            await next();
            return;
        }

        var userId = context.HttpContext.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        var confirmed = false;
        if (!string.IsNullOrWhiteSpace(userId))
        {
            var db = context.HttpContext.RequestServices.GetRequiredService<ApplicationDbContext>();
            confirmed = await db.Users.AsNoTracking().AnyAsync(u => u.Id == userId && u.EmailConfirmed);
        }

        if (!confirmed)
        {
            context.Result = new ObjectResult(new EmailConfirmationRequiredResult(
                "email_confirmation_required",
                "Чтобы пользоваться ИИ-функциями, подтвердите email по ссылке из письма."))
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
            return;
        }

        await next();
    }
}
