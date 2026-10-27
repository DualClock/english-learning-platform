using EnglishLearningPlatform.API.Middleware;
using Microsoft.AspNetCore.Http;

namespace EnglishLearningPlatform.API.Tests.Security;

public class SecurityHeadersTests
{
    [Fact]
    public async Task InvokeAsync_SetsDefensiveHeaders_AndCallsNext()
    {
        var nextCalled = false;
        var middleware = new SecurityHeadersMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var context = new DefaultHttpContext();
        await middleware.InvokeAsync(context);

        Assert.True(nextCalled);
        Assert.Equal("nosniff", context.Response.Headers["X-Content-Type-Options"]);
        Assert.Equal("DENY", context.Response.Headers["X-Frame-Options"]);
        Assert.Equal("no-referrer", context.Response.Headers["Referrer-Policy"]);
        Assert.Contains("camera=()", context.Response.Headers["Permissions-Policy"].ToString());
        Assert.Equal("same-site", context.Response.Headers["Cross-Origin-Resource-Policy"]);
    }
}
