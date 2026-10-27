using System.Text.Json;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// TheoryHtml — единственное HTML-поле, которое фронтенд вставляет через
/// dangerouslySetInnerHTML. API обязан отдавать его очищенным: <script>,
/// обработчики событий и javascript:-ссылки не должны доходить до браузера.
/// </summary>
public class GrammarHtmlSanitizationTests
{
    private const string MaliciousTheory =
        "<p>Правило</p>" +
        "<script>alert(1)</script>" +
        "<img src=\"x\" onerror=\"alert(2)\">" +
        "<a href=\"javascript:alert(3)\">ссылка</a>" +
        "<b onclick=\"alert(4)\">жирный</b>";

    private static async Task<(GrammarController Controller, int UnitId)> CreateControllerAsync()
    {
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        var unit = new GrammarUnit
        {
            Order = 1,
            Title = "Тестовый юнит",
            CefrLevel = "a1",
            Section = "Тест",
            TheoryHtml = MaliciousTheory
        };
        context.GrammarUnits.Add(unit);
        await context.SaveChangesAsync();

        var controller = new GrammarController(context, new ActivityService(context));
        return (controller, unit.Id);
    }

    private static string GetTheoryHtml(ActionResult<object> action)
    {
        var ok = Assert.IsType<OkObjectResult>(action.Result);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.GetProperty("TheoryHtml").GetString() ?? string.Empty;
    }

    [Fact]
    public async Task GetUnit_StripsScriptTags()
    {
        var (controller, unitId) = await CreateControllerAsync();

        var html = GetTheoryHtml(await controller.GetUnit(unitId));

        Assert.DoesNotContain("<script", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("alert(1)", html);
    }

    [Fact]
    public async Task GetUnit_StripsEventHandlers()
    {
        var (controller, unitId) = await CreateControllerAsync();

        var html = GetTheoryHtml(await controller.GetUnit(unitId));

        Assert.DoesNotContain("onerror", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("onclick", html, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GetUnit_StripsJavascriptUrls()
    {
        var (controller, unitId) = await CreateControllerAsync();

        var html = GetTheoryHtml(await controller.GetUnit(unitId));

        Assert.DoesNotContain("javascript:", html, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GetUnit_KeepsSafeFormatting()
    {
        var (controller, unitId) = await CreateControllerAsync();

        var html = GetTheoryHtml(await controller.GetUnit(unitId));

        Assert.Contains("<p>Правило</p>", html);
        Assert.Contains("<b>жирный</b>", html);
    }
}
