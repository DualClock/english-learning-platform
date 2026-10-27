using System.Net.Sockets;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Diagnostics;
using Npgsql;

namespace EnglishLearningPlatform.API.Middleware;

// Глобальный обработчик непойманных исключений: любая ошибка в контроллерах
// и сервисах возвращается фронтенду единым ProblemDetails-ответом 500
// вместо стека ASP.NET-страницы, а причина попадает в журнал Serilog.
// В Development добавляем detail, чтобы локально было видно причину.
public class GlobalExceptionHandler : IExceptionHandler
{
    private const string DatabaseUnavailableMessage =
        "Сервис временно не может подключиться к базе данных. " +
        "Проверьте, что Postgres запущен: docker start english_platform_db.";

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

        // Глобальный дневной бюджет Gemini исчерпан (A6) — тоже 429,
        // но сообщение про сервис, а не про конкретного пользователя
        if (exception is AiGlobalBudgetExceededException)
        {
            await Results.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: "Дневной лимит ИИ-запросов исчерпан",
                detail: AiQuotaService.GlobalBudgetExceededMessage
            ).ExecuteAsync(httpContext);
            return true;
        }

        // Превышена частота AI-вызовов за минуту (R-07) — то же 429, но
        // короткое: окно сбрасывается через минуту, поэтому клиенту нужен
        // Retry-After, а не «ждите до полуночи».
        if (exception is AiRateLimitExceededException)
        {
            httpContext.Response.Headers["Retry-After"] = "60";
            await Results.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: "Слишком частые обращения к ИИ",
                detail: AiQuotaService.RateLimitedMessage
            ).ExecuteAsync(httpContext);
            return true;
        }

        // Упавший Postgres/Docker — не «ошибка кода», а недоступность зависимости:
        // 503 с подсказкой, что именно проверить, вместо сырого 500
        if (IsDatabaseUnavailable(exception))
        {
            _logger.LogError(
                exception,
                "База данных недоступна в {Method} {Path}",
                httpContext.Request.Method,
                httpContext.Request.Path);

            await Results.Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "База данных недоступна",
                detail: _environment.IsDevelopment()
                    ? $"{DatabaseUnavailableMessage} ({exception.GetBaseException().Message})"
                    : DatabaseUnavailableMessage
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

    // Отличаем обрыв соединения от ошибки SQL: PostgresException (неверный запрос,
    // нарушение ограничения) — это баг в коде, а не недоступность базы.
    private static bool IsDatabaseUnavailable(Exception exception)
    {
        for (var current = exception; current != null; current = current.InnerException)
        {
            switch (current)
            {
                case PostgresException:
                    return false;

                case SocketException:
                    return true;

                case NpgsqlException { IsTransient: true }:
                    return true;
            }
        }

        return false;
    }
}
