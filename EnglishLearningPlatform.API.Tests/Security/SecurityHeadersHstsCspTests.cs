using EnglishLearningPlatform.API.Middleware;
using Microsoft.AspNetCore.Http;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// A4 (SECURITY_GATE 1.3): HSTS отдаём только по HTTPS — по незащищённому
/// соединению он бесполезен и вреден (MITM может «запомнить» неправильную
/// политику). CSP ограничиваем frame-ancestors: полный CSP сломал бы
/// inline-стили и шрифты на фронтенде.
/// </summary>
public class SecurityHeadersHstsCspTests
{
    private static async Task<DefaultHttpContext> RunAsync(string scheme)
    {
        var middleware = new SecurityHeadersMiddleware(_ => Task.CompletedTask);
        var context = new DefaultHttpContext();
        context.Request.Scheme = scheme;
        await middleware.InvokeAsync(context);
        return context;
    }

    [Fact]
    public async Task InvokeAsync_HttpsRequest_AddsHstsWithIncludeSubDomains()
    {
        var context = await RunAsync("https");

        var hsts = context.Response.Headers["Strict-Transport-Security"].ToString();
        Assert.Contains("max-age=", hsts);
        Assert.Contains("includeSubDomains", hsts);
    }

    [Fact]
    public async Task InvokeAsync_HttpRequest_DoesNotAddHsts()
    {
        var context = await RunAsync("http");

        Assert.False(context.Response.Headers.ContainsKey("Strict-Transport-Security"));
    }

    [Fact]
    public async Task InvokeAsync_HttpsRequest_AddsCspFrameAncestorsNone()
    {
        var context = await RunAsync("https");

        var csp = context.Response.Headers["Content-Security-Policy"].ToString();
        Assert.Contains("frame-ancestors 'none'", csp);
    }

    [Fact]
    public async Task InvokeAsync_HttpRequest_AddsCspFrameAncestorsNone()
    {
        var context = await RunAsync("http");

        var csp = context.Response.Headers["Content-Security-Policy"].ToString();
        Assert.Contains("frame-ancestors 'none'", csp);
    }
}
