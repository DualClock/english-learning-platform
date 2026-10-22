using System.Security.Claims;
using System.Text.Json;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// Сессии чтения живут в памяти процесса. Без лимитов авторизованный
/// пользователь может раздуть одну сессию тысячами слов или открыть
/// неограниченное число сессий — это исчерпание памяти инстанса.
/// </summary>
public class ReadingSessionLimitsTests
{
    private const string UserId = "reader-1";

    private static (ReadingSessionController Controller, ApplicationDbContext Context, IMemoryCache Cache) Create()
    {
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        var book = new Book
        {
            Title = "Test book",
            UploadedByUserId = UserId,
            FilePath = "test.epub",
            Language = "en"
        };
        context.Books.Add(book);
        context.SaveChanges();

        var cache = new MemoryCache(new MemoryCacheOptions());
        var controller = new ReadingSessionController(
            context,
            new DictionaryService(context),
            new ActivityService(context),
            cache,
            NullLogger<ReadingSessionController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, UserId) },
                        authenticationType: "Test"))
                }
            }
        };

        return (controller, context, cache);
    }

    private static Guid GetSessionId(IActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.GetProperty("sessionId").GetGuid();
    }

    [Fact]
    public async Task AddWord_OverLimit_Rejected()
    {
        var (controller, context, _) = Create();
        var bookId = context.Books.Single().Id;
        var sessionId = GetSessionId(await controller.StartSession(new StartSessionRequest { BookId = bookId }));

        for (var index = 0; index < ReadingSessionController.MaxWordsPerSession; index++)
        {
            var added = controller.AddWord(sessionId, new AddSessionWordRequest { Text = $"word{index}", Page = 1 });
            Assert.IsType<OkObjectResult>(added);
        }

        var overflow = controller.AddWord(sessionId, new AddSessionWordRequest { Text = "one-too-many", Page = 1 });

        Assert.IsType<BadRequestObjectResult>(overflow);
    }

    [Fact]
    public async Task AddWord_DuplicateAtLimit_IsStillIdempotent()
    {
        var (controller, context, _) = Create();
        var bookId = context.Books.Single().Id;
        var sessionId = GetSessionId(await controller.StartSession(new StartSessionRequest { BookId = bookId }));

        for (var index = 0; index < ReadingSessionController.MaxWordsPerSession; index++)
        {
            controller.AddWord(sessionId, new AddSessionWordRequest { Text = $"word{index}", Page = 1 });
        }

        // Повтор уже известного слова не увеличивает сессию и не должен падать
        var duplicate = controller.AddWord(sessionId, new AddSessionWordRequest { Text = "word0", Page = 1 });

        Assert.IsType<OkObjectResult>(duplicate);
    }

    [Fact]
    public async Task StartSession_OverUserLimit_EvictsOldestSession()
    {
        var (controller, context, _) = Create();
        var bookId = context.Books.Single().Id;

        Guid firstSession = Guid.Empty;
        Guid lastSession = Guid.Empty;
        for (var index = 0; index < ReadingSessionController.MaxActiveSessionsPerUser + 1; index++)
        {
            var sessionId = GetSessionId(await controller.StartSession(new StartSessionRequest { BookId = bookId }));
            if (index == 0) firstSession = sessionId;
            lastSession = sessionId;
        }

        Assert.IsType<NotFoundObjectResult>(controller.GetSession(firstSession));
        Assert.IsType<OkObjectResult>(controller.GetSession(lastSession));
    }
}
