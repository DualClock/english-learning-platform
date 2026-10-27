using System.Security.Claims;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// AI-ассистент админки.
///
/// Два инварианта важнее качества текста (его здесь не проверить — модель
/// внешняя): админский лимит не пересекается с пользовательским, и
/// выключенный ассистент честно говорит «выключен», а не падает 500.
/// </summary>
public class AdminAssistantTests
{
    private static ApplicationDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("assistant-" + Guid.NewGuid())
            .Options;
        return new ApplicationDbContext(options);
    }

    private static AiQuotaService Quota(
        ApplicationDbContext context,
        int adminLimit = 100,
        int userLimit = 300)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ai:AdminDailyRequestLimit"] = adminLimit.ToString(),
                ["Ai:DailyUserRequestLimit"] = userLimit.ToString(),
                ["Ai:DailyUserTokenLimit"] = "300000",
                ["Ai:GlobalDailyRequestLimit"] = "2000",
            })
            .Build();

        return new AiQuotaService(
            context,
            new MemoryCache(new MemoryCacheOptions()),
            config,
            NullLogger<AiQuotaService>.Instance);
    }

    private static async Task LogCallsAsync(ApplicationDbContext context, string requestType, int count, string userId = "admin-1")
    {
        for (var i = 0; i < count; i++)
        {
            context.AiUsageLogs.Add(new AiUsageLog
            {
                UserId = userId,
                RequestType = requestType,
                Model = "gemini-test",
                PromptTokens = 10,
                CompletionTokens = 20,
                TotalTokens = 30,
                Success = true,
                CreatedAt = DateTime.UtcNow,
            });
        }

        await context.SaveChangesAsync();
    }

    [Fact]
    public async Task Админская_квота_считает_только_свои_вызовы()
    {
        var context = NewContext();
        await LogCallsAsync(context, "admin-article", 3);
        await LogCallsAsync(context, "translate", 10);

        var quota = Quota(context);

        // 3 админских из 100; ученические 10 не должны попасть в счёт.
        Assert.Equal(3, await quota.GetAdminTodayRequestsAsync());
    }

    [Fact]
    public async Task Ученические_вызовы_не_съедают_админский_лимит()
    {
        var context = NewContext();
        await LogCallsAsync(context, "translate", 50);

        var quota = Quota(context, adminLimit: 5);

        Assert.True(await quota.IsWithinAdminQuotaAsync());
    }

    [Fact]
    public async Task Исчерпанный_админский_лимит_закрывает_ассистента()
    {
        var context = NewContext();
        await LogCallsAsync(context, "admin-article", 5);

        var quota = Quota(context, adminLimit: 5);

        Assert.False(await quota.IsWithinAdminQuotaAsync());
    }

    [Fact]
    public async Task Нулевой_лимит_выключает_ассистента()
    {
        // Ноль — «выключено», а не «безлимит»: опечатка в конфиге не должна
        // открывать неограниченный расход на чужой счёт.
        var context = NewContext();
        var quota = Quota(context, adminLimit: 0);

        Assert.False(await quota.IsWithinAdminQuotaAsync());
    }

    [Fact]
    public async Task Админские_вызовы_не_тратят_пользовательскую_квоту()
    {
        // Обратная сторона: админ не должен оставить учеников без переводов.
        var context = NewContext();
        var quota = Quota(context, userLimit: 100);

        // У ученика ноль вызовов, хотя админ сделал сто.
        await LogCallsAsync(context, "admin-article", 100);
        Assert.True(await quota.IsWithinQuotaAsync("student-1"));
        Assert.Equal(0, (await quota.GetTodayUsageAsync("student-1")).Requests);
    }

    [Fact]
    public void Лимит_берётся_из_конфигурации_а_не_из_пользовательского()
    {
        var context = NewContext();
        var quota = Quota(context, adminLimit: 42, userLimit: 300);

        Assert.Equal(42, quota.AdminRequestLimit);
        Assert.Equal(300, quota.RequestLimit);
    }

    [Fact]
    public void Контроллер_требует_роль_Админа()
    {
        var type = typeof(AdminAssistantController);
        var hasClassLevel = type.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Any(a => a.Roles != null && a.Roles.Contains("Admin"));

        Assert.True(hasClassLevel, "AdminAssistantController не защищён ролью Admin");
    }

    [Fact]
    public async Task Пустой_запрос_на_статью_отвергается_до_провайдера()
    {
        // Тратить чужой бюджет на «сгенерируй статью без темы» — деньги на
        // воздух. Валидация до вызова модели.
        var controller = new AdminAssistantController(
            ai: null!,
            quota: Quota(NewContext()));

        var result = await controller.Article(
            new AdminAssistantController.ArticleDraftRequest { Topic = "   " },
            default);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Исчерпанный_лимит_даёт_429_а_не_500()
    {
        var context = NewContext();
        await LogCallsAsync(context, "admin-article", 2);

        var controller = new AdminAssistantController(
            ai: null!,
            quota: Quota(context, adminLimit: 2));

        var result = await controller.Article(
            new AdminAssistantController.ArticleDraftRequest { Topic = "Present Perfect" },
            default);

        // 429, а не 500: это ожидаемое состояние «на сегодня всё», и клиент
        // должен показать это человеку, а не «ошибка сервера».
        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(429, status.StatusCode);
    }
}
