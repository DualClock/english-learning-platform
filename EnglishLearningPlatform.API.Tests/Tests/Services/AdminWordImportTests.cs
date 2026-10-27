using System.Security.Claims;
using System.Text;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services.Import;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Импорт слов в категорию.
///
/// Главный инвариант: импорт не создаёт дублей с тем, что уже есть в базе.
/// Второй по важности: строка, которая падает, не отменяет остальные —
/// админ должен получить записанное плюс список проблемных строк.
/// </summary>
public class AdminWordImportTests
{
    private static ApplicationDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("import-" + Guid.NewGuid())
            // InMemory не умеет транзакции и по умолчанию бросает на BeginTransaction.
            // Мы проверяем логику импорта, а не работу транзакций — сам rollback
            // проверяется на реальном Npgsql в отдельном тесте.
            .ConfigureWarnings(w => w.Ignore(
                Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        var context = new ApplicationDbContext(options);
        context.Categories.Add(new Category { Id = 1, Name = "Еда", Slug = "food" });
        context.Categories.Add(new Category { Id = 2, Name = "Удалённая", Slug = "gone", DeletedAt = DateTime.UtcNow });
        context.SaveChanges();
        return context;
    }

    private static AdminWordImportController ControllerFor(ApplicationDbContext context)
    {
        var controller = new AdminWordImportController(context, new WordImportParser());
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    new[] { new Claim(ClaimTypes.NameIdentifier, "admin-1") }, "Bearer")),
            },
        };
        return controller;
    }

    private static IFormFile File(string content, string name = "words.csv")
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", name);
    }

    private static async Task<System.Text.Json.JsonElement> Body(IActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        var json = System.Text.Json.JsonSerializer.Serialize(ok.Value, new System.Text.Json.JsonSerializerOptions
        {
            PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
        });
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    [Fact]
    public async Task Импортирует_слова_в_категорию()
    {
        var context = NewContext();
        var csv = "English,Translation\napple,яблоко\nrun,бежать\n";

        var result = await ControllerFor(context).Import(1, File(csv), default);

        var body = await Body(result);
        Assert.Equal(2, body.GetProperty("added").GetInt32());
        Assert.Equal(2, await context.CategoryWords.CountAsync());
    }

    [Fact]
    public async Task Существующие_слова_не_дублируются()
    {
        var context = NewContext();
        context.CategoryWords.Add(new CategoryWord { CategoryId = 1, English = "apple", Translation = "яблоко" });
        await context.SaveChangesAsync();

        var csv = "English,Translation\napple,яблоко\nrun,бежать\n";

        var result = await ControllerFor(context).Import(1, File(csv), default);

        var body = await Body(result);
        Assert.Equal(1, body.GetProperty("added").GetInt32());
        Assert.Equal(1, body.GetProperty("skipped").GetInt32());
        Assert.Equal(2, await context.CategoryWords.CountAsync());
    }

    [Fact]
    public async Task Ошибочная_строка_не_отменяет_остальные()
    {
        // Иначе один битый ряд в файле на 500 слов = импорт не состоялся,
        // и админ ищет его вручную.
        var context = NewContext();
        var csv = "English,Translation\napple,яблоко\nbroken,\nrun,бежать\n";

        var result = await ControllerFor(context).Import(1, File(csv), default);

        var body = await Body(result);
        Assert.Equal(2, body.GetProperty("added").GetInt32());
        Assert.Equal(1, body.GetProperty("errors").GetArrayLength());
    }

    [Fact]
    public async Task Несуществующая_категория_даёт_404()
    {
        var result = await ControllerFor(NewContext()).Import(999, File("English,Translation\na,b\n"), default);

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task Удалённая_категория_не_принимает_импорт()
    {
        // Иначе слова записываются в невидимую категорию, и админ не понимает,
        // почему они нигде не появились.
        var result = await ControllerFor(NewContext()).Import(2, File("English,Translation\na,b\n"), default);

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task Без_файла_даёт_400()
    {
        var result = await ControllerFor(NewContext()).Import(1, null, default);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Файл_неподдерживаемого_типа_отклоняется()
    {
        var result = await ControllerFor(NewContext()).Import(1, File("data", "words.txt"), default);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task JSON_файл_импортируется()
    {
        var context = NewContext();
        var json = """[{"english":"apple","translation":"яблоко"}]""";

        var result = await ControllerFor(context).Import(1, File(json, "words.json"), default);

        var body = await Body(result);
        Assert.Equal(1, body.GetProperty("added").GetInt32());
    }

    [Fact]
    public async Task Импорт_пробный_режим_ничего_не_пишет()
    {
        // Админ должен увидеть, что получится, до записи 500 строк.
        var context = NewContext();
        var csv = "English,Translation\napple,яблоко\nrun,бежать\n";

        var result = await ControllerFor(context).Import(1, File(csv), default, dryRun: true);

        var body = await Body(result);
        Assert.Equal(2, body.GetProperty("added").GetInt32());
        Assert.Equal(0, await context.CategoryWords.CountAsync());
    }

    [Fact]
    public void Контроллер_требует_роль_Админа()
    {
        var type = typeof(AdminWordImportController);
        var hasRoles = type.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Any(a => a.Roles != null && a.Roles.Contains("Admin"));

        Assert.True(hasRoles, "AdminWordImportController не защищён ролью Admin");
    }
}
