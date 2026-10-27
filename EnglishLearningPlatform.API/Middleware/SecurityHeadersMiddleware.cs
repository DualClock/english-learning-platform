namespace EnglishLearningPlatform.API.Middleware;

/// <summary>
/// Защитные HTTP-заголовки для всех ответов API.
/// nosniff особенно важен для /uploads/covers: обложка из EPUB сохраняется
/// как .jpg, и без него браузер мог бы «досниффить» тип до HTML.
/// </summary>
public sealed class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;

    public SecurityHeadersMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Response.Headers;
        headers["X-Content-Type-Options"] = "nosniff";
        headers["X-Frame-Options"] = "DENY";
        headers["Referrer-Policy"] = "no-referrer";
        headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
        headers["Cross-Origin-Resource-Policy"] = "same-site";
        // Полный CSP сломал бы inline-стили и шрифты фронтенда, поэтому
        // ограничиваемся frame-ancestors: API нельзя встроить в чужой iframe.
        headers["Content-Security-Policy"] = "frame-ancestors 'none'";

        // HSTS только по HTTPS: отправленный по незащищённому соединению,
        // он мог бы быть подменён MITM, а браузеры игнорируют HSTS с http-ответов.
        if (context.Request.IsHttps)
        {
            headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
        }

        await _next(context);
    }
}
