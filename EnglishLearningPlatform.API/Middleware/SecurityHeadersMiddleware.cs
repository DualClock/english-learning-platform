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

        await _next(context);
    }
}
