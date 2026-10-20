using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Diagnostics;

namespace EnglishLearningPlatform.API.Middleware;

// Глобальный обработчик непойманных исключений: любая ошибка в контроллерах
// и сервисах возвращается фронтенду единым ProblemDetails-ответом 500
// вместо стека ASP.NET-страницы, а причина попадает в журнал Serilog.
// В Development добавляем detail, чтобы локально было видно причину.
public class GlobalExceptionHandler : IExceptionHandler
{
    private readonly ILogger<GlobalExceptionHandler> _logger;
    private readonly IHostEnvironment _environment;

    public GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger, IHostEnvironment environment)
    {
        _logger = logger;
        _environment = environment;
    }

    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        // Исчерпанная квота — ожидаемая ситуация, не ошибка сервера
        if (exception is AiQuotaExceededException)
        {
            await Results.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: "Дневной лимит ИИ-запросов исчерпан",
                detail: AiQuotaService.QuotaExceededMessage
            ).ExecuteAsync(httpContext);
            return true;
        }

        _logger.LogError(
            exception,
            "Необработанное исключение в {Method} {Path}",
            httpContext.Request.Method,
            httpContext.Request.Path);

        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;

        await Results.Problem(
            statusCode: StatusCodes.Status500InternalServerError,
            title: "Внутренняя ошибка сервера",
            detail: _environment.IsDevelopment() ? exception.Message : null,
            extensions: _environment.IsDevelopment()
                ? new Dictionary<string, object?> { ["exceptionType"] = exception.GetType().Name }
                : null
        ).ExecuteAsync(httpContext);

        return true;
    }
}
