using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// Флаг Auth:RequireConfirmedEmail на гейте подтверждения почты (SECURITY_GATE 1.5).
///
/// Почтовые транспорты недоступны: SMTP-порты на VPS режет хостер, а Google и Яндекс
/// SMTP с этого адреса не отвечают. Если при этом требовать подтверждение, каждый новый
/// аккаунт получает 403 на клик по слову — то есть гейт ломает продукт вместо того, чтобы
/// беречь бюджет. Проверка остаётся в коде и включается одной строкой конфига, поэтому
/// здесь фиксируются обе ветки: выключенный флаг пропускает неподтверждённого,
/// включённый — по-прежнему отказывает.
/// </summary>
public class EmailConfirmationGateFlagTests
{
    [Fact]
    public async Task Флаг_выключен_неподтверждённый_проходит_к_экшену()
    {
        var (result, nextCalled) = await RunAsync(requireConfirmed: false, confirmedUser: false);

        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task Флаг_включён_или_не_задан_неподтверждённый_получает_403()
    {
        var off = await RunAsync(requireConfirmed: null, confirmedUser: false);

        Assert.False(off.nextCalled);
        var body = Assert.IsType<EmailConfirmationRequiredResult>(
            Assert.IsType<ObjectResult>(off.result).Value);
        Assert.Equal("email_confirmation_required", body.Error);
    }

    [Fact]
    public async Task Флаг_включён_подтверждённый_проходит()
    {
        var on = await RunAsync(requireConfirmed: true, confirmedUser: true);

        Assert.True(on.nextCalled);
        Assert.Null(on.result);
    }

    private static async Task<(object? result, bool nextCalled)> RunAsync(
        bool? requireConfirmed,
        bool confirmedUser)
    {
        await using var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        const string userId = "probe-user";
        context.Users.Add(new User
        {
            Id = userId,
            UserName = "probe@example.com",
            Email = "probe@example.com",
            EmailConfirmed = confirmedUser
        });
        await context.SaveChangesAsync();

        var configMap = new Dictionary<string, string?>();
        if (requireConfirmed.HasValue)
        {
            configMap[RequireConfirmedEmailAttribute.ConfigKey] = requireConfirmed.Value ? "true" : "false";
        }

        IConfiguration configuration = new ConfigurationBuilder().AddInMemoryCollection(configMap).Build();

        var services = new ServiceCollection();
        services.AddSingleton(configuration);
        services.AddSingleton(context);
        await using var provider = services.BuildServiceProvider();

        var identity = new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, userId) }, authenticationType: "Test");
        var httpContext = new DefaultHttpContext
        {
            RequestServices = provider,
            User = new ClaimsPrincipal(identity)
        };

        var actionContext = new ActionContext(httpContext, new RouteData(), new ActionDescriptor());
        var executing = new ActionExecutingContext(
            actionContext,
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            controller: new object());

        var nextCalled = false;

        await new RequireConfirmedEmailAttribute().OnActionExecutionAsync(
            executing,
            async () =>
            {
                nextCalled = true;
                return await Task.FromResult(new ActionExecutedContext(
                    actionContext, new List<IFilterMetadata>(), controller: new object()));
            });

        return (executing.Result, nextCalled);
    }
}
