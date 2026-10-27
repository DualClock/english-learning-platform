using System.Security.Claims;
using System.Text;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Tests.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// W2.5.3 — удаление аккаунта.
///
/// /privacy обещает читателю три вещи: удаляется ВСЁ, что связано с ним,
/// удаляется СРАЗУ, и чужие данные при этом не страдают. Обещание проверяется
/// не «по ощущению от кода», а на настоящей реляционной базе: SQLite с
/// включёнными внешними ключами, потому что on-memory-провайдер не знает ни
/// каскадов, ни транзакций, и тест на нём проверял бы только то, что код
/// скомпилировался.
///
/// Отдельно держится граница «не трогаем чужое»: в харнесе два пользователя,
/// удаляется один, и проверяется второй — строки, книги и файлы. Это ровно
/// та ошибка, которую легко сделать в delete-пути и невозможно заметить в
/// UI: удаляющий «все строки по шаблону» контроллер выглядит зелёным до
/// первого же второго тестера в базе.
/// </summary>
public sealed class AccountDeletionHarness : IAsyncDisposable
{
    public SqliteConnection Connection { get; } = new("DataSource=:memory:");
    public ApplicationDbContext Context { get; private set; } = null!;
    public UserManager<User> UserManager { get; private set; } = null!;
    public AuthController Auth { get; private set; } = null!;
    public MemoryCache Cache { get; private set; } = null!;

    /// <summary>
    /// Content root с каталогом uploads/: файлы удаляются относительно него,
    /// и именно здесь видно, тронул ли контроллер чужую загрузку.
    /// </summary>
    public string Root { get; private set; } = null!;

    public string UploadsPath => Path.Combine(Root, "uploads");

    public async Task<string> CreateUserAsync(string email)
    {
        var user = new User
        {
            UserName = email,
            Email = email,
            EmailConfirmed = true,
            DisplayName = email.Split('@')[0],
            AvatarUrl = $"/uploads/avatars/{Guid.NewGuid():N}.webp",
        };
        var created = await UserManager.CreateAsync(user, "Password1");
        Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
        CreateUploadFile("avatars", Path.GetFileName(user.AvatarUrl!));
        return user.Id;
    }

    public AccountController CreateAccountController(string userId)
    {
        var controller = new AccountController(
            UserManager,
            Context,
            new TestWebHostEnvironment { ContentRootPath = Root },
            Cache,
            NullLogger<AccountController>.Instance);

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    new[] { new Claim(ClaimTypes.NameIdentifier, userId) },
                    authenticationType: "test"))
            }
        };

        return controller;
    }

    public void CreateUploadFile(string subFolder, string fileName)
    {
        var directory = Path.Combine(UploadsPath, subFolder);
        Directory.CreateDirectory(directory);
        File.WriteAllBytes(Path.Combine(directory, fileName), Encoding.UTF8.GetBytes($"payload of {fileName}"));
    }

    public bool UploadFileExists(string subFolder, string fileName) =>
        File.Exists(Path.Combine(UploadsPath, subFolder, fileName));

    /// <summary>
    /// Заполняет за собой по одной строке в каждой таблице, где есть UserId
    /// пользователя, плюс книги с тремя видами файлов: свой EPUB, своя
    /// обложка, общая обложка рассказа. Возвращает имена файлов, которые
    /// обязаны исчезнуть вместе с владельцем.
    /// </summary>
    public async Task<UserFiles> SeedUserDataAsync(string userId)
    {
        var word = new Word { Text = $"whale-{userId[..8]}", Language = "en" };
        word.Definitions.Add(new WordDefinition { Definition = "кит" });
        Context.Words.Add(word);

        var unit = new GrammarUnit { Title = "Past Simple", CefrLevel = "a2", Order = 1 };
        Context.GrammarUnits.Add(unit);

        var category = new Category { Name = "Погода", Slug = $"weather-{userId[..8]}" };
        var categoryWord = new CategoryWord { English = "drizzle", Translation = "морось" };
        category.Words.Add(categoryWord);
        Context.Categories.Add(category);

        await Context.SaveChangesAsync();

        var ownBook = new Book
        {
            Title = $"Мой EPUB {userId[..8]}",
            Author = "Test Author",
            Language = "en",
            FilePath = $"{Guid.NewGuid():N}.epub",
            FileSize = 128,
            CoverUrl = $"/uploads/covers/{Guid.NewGuid():N}.jpg",
            UploadedByUserId = userId,
        };

        // Рассказ: файл у пользователя свой, обложка — общая на всех
        // (uploads/covers/story-0.svg), и удалять её нельзя ни при каких
        // обстоятельствах.
        var storyBook = new Book
        {
            Title = $"Рассказ {userId[..8]}",
            Author = "Lexicon Stories",
            Language = "en",
            FilePath = $"{Guid.NewGuid():N}.epub",
            FileSize = 64,
            CoverUrl = "/uploads/covers/story-0.svg",
            UploadedByUserId = userId,
        };

        Context.Books.AddRange(ownBook, storyBook);
        await Context.SaveChangesAsync();

        var wordImage = $"{Guid.NewGuid():N}.png";

        Context.UserWords.Add(new UserWord
        {
            UserId = userId,
            WordId = word.Id,
            Source = "reader",
            ImageUrl = $"/uploads/word-images/{wordImage}",
            NextReviewDate = DateTime.UtcNow.AddDays(1),
        });
        Context.UserKnownWords.Add(new UserKnownWord { UserId = userId, Text = "the" });
        Context.ReviewLogs.Add(new ReviewLog { UserId = userId, WordId = word.Id, Quality = 4 });
        Context.UserErrorBankEntries.Add(new UserErrorBankEntry
        {
            UserId = userId,
            Original = "I has a book",
            Suggestion = "I have a book",
        });
        Context.Interactions.Add(new Interaction
        {
            UserId = userId,
            BookId = ownBook.Id,
            WordId = word.Id,
            Source = "reader",
            ContextSentence = "The whale surfaced twice.",
        });
        Context.DailyActivities.Add(new DailyActivity
        {
            UserId = userId,
            Date = DateTime.UtcNow.Date,
            MinutesRead = 12,
            WordsReviewed = 5,
        });
        Context.XpEvents.Add(new XpEvent { UserId = userId, Xp = 20, Reason = "read_page" });
        Context.LeagueHistories.Add(new LeagueHistory
        {
            UserId = userId,
            WeekStart = DateTime.UtcNow.Date.AddDays(-3),
            League = "bronze",
            Rank = 2,
            Participants = 8,
            WeeklyXp = 20,
        });
        Context.UserAchievements.Add(new UserAchievement { UserId = userId, Code = "first_book" });
        Context.UserGrammarProgresses.Add(new UserGrammarProgress
        {
            UserId = userId,
            UnitId = unit.Id,
            Score = 5,
            CompletedAt = DateTime.UtcNow,
        });
        Context.UserCategoryWordProgresses.Add(new UserCategoryWordProgress
        {
            UserId = userId,
            CategoryWordId = categoryWord.Id,
            Status = "learning",
        });
        Context.AnalyticsEvents.Add(new AnalyticsEvent { UserId = userId, Event = "book_opened", Meta = ownBook.Title });
        Context.AnalyticsEvents.Add(new AnalyticsEvent { UserId = userId, Event = "chapter_opened_first", Meta = ownBook.Title });
        Context.BookBookmarks.Add(new BookBookmark
        {
            UserId = userId,
            BookId = ownBook.Id,
            Page = 3,
            Note = "здесь тяжело",
        });
        Context.BookKeyWords.Add(new BookKeyWord
        {
            BookId = ownBook.Id,
            WordText = "whale",
            CefrLevel = "b1",
            FreqRank = 900,
            Page = 1,
            Frequency = 4,
        });
        Context.AiUsageLogs.Add(new AiUsageLog
        {
            UserId = userId,
            RequestType = "translate",
            Model = "gemini-2.5-flash",
            TotalTokens = 42,
            Success = true,
        });
        Context.EmailMessages.Add(new EmailMessage
        {
            UserId = userId,
            To = "tester@example.com",
            Subject = "Напоминание",
            Body = "Пора читать",
            Kind = "reminder",
        });

        var role = new IdentityRole("beta") { Id = Guid.NewGuid().ToString("N") };
        Context.Roles.Add(role);
        await Context.SaveChangesAsync();

        Context.UserRoles.Add(new IdentityUserRole<string> { UserId = userId, RoleId = role.Id });
        Context.UserClaims.Add(new IdentityUserClaim<string> { UserId = userId, ClaimType = "display", ClaimValue = "Тест" });
        Context.UserLogins.Add(new IdentityUserLogin<string>
        {
            UserId = userId,
            LoginProvider = "test",
            ProviderKey = userId,
            ProviderDisplayName = "test",
        });
        Context.UserTokens.Add(new IdentityUserToken<string>
        {
            UserId = userId,
            LoginProvider = "test",
            Name = "token",
            Value = "value",
        });

        await Context.SaveChangesAsync();

        var avatarName = Path.GetFileName((await UserManager.FindByIdAsync(userId))!.AvatarUrl!);
        CreateUploadFile("books", Path.GetFileName(ownBook.FilePath));
        CreateUploadFile("covers", Path.GetFileName(ownBook.CoverUrl!));
        CreateUploadFile("books", Path.GetFileName(storyBook.FilePath));
        CreateUploadFile("covers", "story-0.svg");
        CreateUploadFile("word-images", wordImage);

        return new UserFiles(
            ownBook.FilePath,
            Path.GetFileName(ownBook.CoverUrl!),
            storyBook.FilePath,
            wordImage,
            avatarName);
    }

    public async ValueTask DisposeAsync()
    {
        await Connection.DisposeAsync();
        Cache.Dispose();
        if (Directory.Exists(Root))
        {
            try
            {
                Directory.Delete(Root, recursive: true);
            }
            catch (IOException)
            {
                // временный каталог теста не должен ронять прогон из-за
                // залитого антивирусом файла
            }
        }
    }

    public record UserFiles(string BookFile, string CoverFile, string StoryFile, string WordImage, string Avatar);

    public static async Task<AccountDeletionHarness> CreateAsync()
    {
        var root = Path.Combine(AppContext.BaseDirectory, $"account-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);

        var harness = new AccountDeletionHarness { Root = root };
        await harness.Connection.OpenAsync();

        // SQLite не включает проверку внешних ключей сам, а без них тест
        // проверял бы только явные DELETE и молчал про каскады.
        await using (var pragma = harness.Connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA foreign_keys = ON;";
            await pragma.ExecuteNonQueryAsync();
        }

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDataProtection();
        services.AddDbContext<ApplicationDbContext>(options => options.UseSqlite(harness.Connection));
        services.AddIdentityCore<User>(options =>
            {
                options.Password.RequiredLength = 6;
                options.Password.RequireNonAlphanumeric = false;
            })
            .AddRoles<IdentityRole>()
            .AddEntityFrameworkStores<ApplicationDbContext>()
            .AddDefaultTokenProviders();

        var provider = services.BuildServiceProvider();
        var context = provider.GetRequiredService<ApplicationDbContext>();
        await context.Database.EnsureCreatedAsync();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-secret-key-for-account-tests-32ch",
                ["Jwt:Issuer"] = "TestIssuer",
                ["Jwt:Audience"] = "TestAudience",
                ["Jwt:ExpiryMinutes"] = "60",
                ["Registration:DailyGlobalLimit"] = "500",
                ["Email:From"] = "no-reply@lexicon.local",
                ["App:FrontendUrl"] = "http://localhost:3000",
            })
            .Build();

        var cache = new MemoryCache(new MemoryCacheOptions());
        var userManager = provider.GetRequiredService<UserManager<User>>();
        var emailSender = new EmailSender(context, configuration, NullLogger<EmailSender>.Instance);

        var auth = new AuthController(
            userManager,
            configuration,
            new AuthEmailService(emailSender, configuration),
            NullLogger<AuthController>.Instance,
            cache,
            new RegistrationQuotaService(context, cache, configuration, NullLogger<RegistrationQuotaService>.Instance));

        harness.Context = context;
        harness.UserManager = userManager;
        harness.Auth = auth;
        harness.Cache = cache;
        return harness;
    }
}

public class AccountDeletionTests
{
    /// <summary>
    /// Ответ контроллера всегда JSON, и «IsType не прошёл» без тела заставляет
    /// гадать, какой из четырёх путей возврата сработал. Тело печатаем сразу.
    /// </summary>
    private static void AssertOk(IActionResult result)
    {
        if (result is OkObjectResult) return;

        var detail = result switch
        {
            ObjectResult objectResult => $"{objectResult.StatusCode} {System.Text.Json.JsonSerializer.Serialize(objectResult.Value)}",
            _ => result.GetType().Name,
        };

        Assert.Fail($"ожидался 200 OK, получен {detail}");
    }

    // ── Подтверждение паролем ──────────────────────────────────────────────

    [Fact]
    public async Task DeleteAccount_WithoutPassword_IsRejectedAndKeepsEverything()
    {
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var userId = await harness.CreateUserAsync("nopassword@example.com");
        var files = await harness.SeedUserDataAsync(userId);

        var result = await harness.CreateAccountController(userId)
            .DeleteAccount(new AccountController.DeleteAccountDto(null), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.NotNull(await harness.UserManager.FindByIdAsync(userId));
        Assert.Equal(2, await harness.Context.Books.CountAsync(b => b.UploadedByUserId == userId));
        Assert.True(harness.UploadFileExists("books", files.BookFile));
    }

    [Fact]
    public async Task DeleteAccount_WrongPassword_KeepsAccountRowsAndFiles()
    {
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var userId = await harness.CreateUserAsync("wrongpass@example.com");
        var files = await harness.SeedUserDataAsync(userId);

        var result = await harness.CreateAccountController(userId)
            .DeleteAccount(new AccountController.DeleteAccountDto("WrongPassword1"), CancellationToken.None);

        Assert.IsType<UnauthorizedObjectResult>(result);
        Assert.NotNull(await harness.UserManager.FindByIdAsync(userId));
        Assert.Equal(1, await harness.Context.UserWords.CountAsync(w => w.UserId == userId));
        Assert.Equal(1, await harness.Context.EmailMessages.CountAsync(m => m.UserId == userId));
        Assert.True(harness.UploadFileExists("books", files.BookFile));
        Assert.True(harness.UploadFileExists("covers", files.CoverFile));
        Assert.True(harness.UploadFileExists("word-images", files.WordImage));
        Assert.True(harness.UploadFileExists("avatars", files.Avatar));
    }

    [Fact]
    public async Task DeleteAccount_BelongsToTokenUserOnly_NotTheGuessedEmail()
    {
        // Удаление берёт аккаунт из токена, а не из тела запроса: чужой email в
        // запросе не должен куда-то смотреть.
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var victim = await harness.CreateUserAsync("victim@example.com");
        var attacker = await harness.CreateUserAsync("attacker@example.com");
        await harness.SeedUserDataAsync(victim);

        var result = await harness.CreateAccountController(attacker)
            .DeleteAccount(new AccountController.DeleteAccountDto("Password1"), CancellationToken.None);

        AssertOk(result);
        Assert.Null(await harness.UserManager.FindByIdAsync(attacker));
        Assert.NotNull(await harness.UserManager.FindByIdAsync(victim));
    }

    // ── Что реально уходит из базы ─────────────────────────────────────────

    [Fact]
    public async Task DeleteAccount_RemovesUserRowAndAllOwnedTables()
    {
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var userId = await harness.CreateUserAsync("gone@example.com");
        await harness.SeedUserDataAsync(userId);

        var result = await harness.CreateAccountController(userId)
            .DeleteAccount(new AccountController.DeleteAccountDto("Password1"), CancellationToken.None);

        AssertOk(result);
        Assert.Null(await harness.UserManager.FindByIdAsync(userId));

        Assert.Equal(0, await harness.Context.Books.CountAsync(b => b.UploadedByUserId == userId));
        Assert.Equal(0, await harness.Context.UserWords.CountAsync(w => w.UserId == userId));
        Assert.Equal(0, await harness.Context.AnalyticsEvents.CountAsync(e => e.UserId == userId));
        Assert.Equal(0, await harness.Context.EmailMessages.CountAsync(m => m.UserId == userId));
        Assert.Equal(0, await harness.Context.AiUsageLogs.CountAsync(l => l.UserId == userId));
        Assert.Equal(0, await harness.Context.BookBookmarks.CountAsync(b => b.UserId == userId));
        Assert.Equal(0, await harness.Context.LeagueHistories.CountAsync(h => h.UserId == userId));
        Assert.Equal(0, await harness.Context.UserRoles.CountAsync(r => r.UserId == userId));
        Assert.Equal(0, await harness.Context.UserTokens.CountAsync(t => t.UserId == userId));

        // Словарь сервиса и общие книги остаются: удаляется человек, а не библиотека.
        Assert.True(await harness.Context.Words.AnyAsync(w => w.Text.StartsWith("whale-")));
    }

    [Fact]
    public async Task DeleteAccount_LeavesNoRowAnywhereReferencingTheUserId()
    {
        // Сквозная проверка по всей схеме, а не по списку, который написал
        // автор контроллера: если в базе осталась ТАБЛИЦА с колонкой UserId и
        // строкой умершего аккаунта — тест красный, даже если про неё забыли.
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var userId = await harness.CreateUserAsync("scan@example.com");
        await harness.SeedUserDataAsync(userId);

        await harness.CreateAccountController(userId)
            .DeleteAccount(new AccountController.DeleteAccountDto("Password1"), CancellationToken.None);

        var offenders = await FindRowsReferencingAsync(harness.Connection, userId);

        Assert.Empty(offenders);
    }

    [Fact]
    public async Task DeleteAccount_RemovesOwnFilesAndKeepsSharedCover()
    {
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var userId = await harness.CreateUserAsync("files@example.com");
        var files = await harness.SeedUserDataAsync(userId);

        var result = await harness.CreateAccountController(userId)
            .DeleteAccount(new AccountController.DeleteAccountDto("Password1"), CancellationToken.None);

        AssertOk(result);
        Assert.False(harness.UploadFileExists("books", files.BookFile));
        Assert.False(harness.UploadFileExists("covers", files.CoverFile));
        Assert.False(harness.UploadFileExists("books", files.StoryFile));
        Assert.False(harness.UploadFileExists("word-images", files.WordImage));
        Assert.False(harness.UploadFileExists("avatars", files.Avatar));

        // Общая SVG-обложка рассказа живёт в uploads/covers/story-0.svg у всех:
        // чужой выход не должен ломать чужую витрину библиотеки.
        Assert.True(harness.UploadFileExists("covers", "story-0.svg"));
    }

    [Fact]
    public async Task DeleteAccount_OtherUsersKeepTheirRowsAndFiles()
    {
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var leaving = await harness.CreateUserAsync("leaving@example.com");
        var staying = await harness.CreateUserAsync("staying@example.com");
        await harness.SeedUserDataAsync(leaving);
        var stayingFiles = await harness.SeedUserDataAsync(staying);

        await harness.CreateAccountController(leaving)
            .DeleteAccount(new AccountController.DeleteAccountDto("Password1"), CancellationToken.None);

        Assert.NotNull(await harness.UserManager.FindByIdAsync(staying));
        Assert.Equal(1, await harness.Context.UserWords.CountAsync(w => w.UserId == staying));
        Assert.Equal(2, await harness.Context.Books.CountAsync(b => b.UploadedByUserId == staying));
        Assert.Equal(1, await harness.Context.BookBookmarks.CountAsync(b => b.UserId == staying));
        Assert.True(harness.UploadFileExists("books", stayingFiles.BookFile));
        Assert.True(harness.UploadFileExists("covers", stayingFiles.CoverFile));
        Assert.True(harness.UploadFileExists("word-images", stayingFiles.WordImage));
        Assert.True(harness.UploadFileExists("avatars", stayingFiles.Avatar));
    }

    [Fact]
    public async Task DeleteAccount_KeepsGuestAnalyticsEvents()
    {
        // Гостевые события /test — не персональные данные этого человека:
        // в них нет UserId, только суточный хеш IP. Удалять их чужим уходом
        // значит врать в воронке тем, кто аккаунт не заводил.
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var userId = await harness.CreateUserAsync("guestadjacent@example.com");
        await harness.SeedUserDataAsync(userId);

        harness.Context.GuestAnalyticsEvents.Add(new GuestAnalyticsEvent
        {
            Event = "placement_test_completed",
            IpHash = new string('a', 64),
            Level = "b1",
            Day = DateOnly.FromDateTime(DateTime.UtcNow),
            Hour = 12,
            DedupeKey = Guid.NewGuid().ToString("N"),
        });
        await harness.Context.SaveChangesAsync();

        await harness.CreateAccountController(userId)
            .DeleteAccount(new AccountController.DeleteAccountDto("Password1"), CancellationToken.None);

        Assert.Equal(1, await harness.Context.GuestAnalyticsEvents.CountAsync());
    }

    // ── Поведение после удаления ────────────────────────────────────────────

    [Fact]
    public async Task DeleteAccount_Twice_ReturnsNotFoundNotCrash()
    {
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var userId = await harness.CreateUserAsync("twice@example.com");
        await harness.SeedUserDataAsync(userId);

        var first = await harness.CreateAccountController(userId)
            .DeleteAccount(new AccountController.DeleteAccountDto("Password1"), CancellationToken.None);
        // Токен после удаления остаётся валидным (механики отзыва в проекте нет),
        // поэтому второй вызов доходит до экшена и должен ответить 404, а не
        // упасть с NullReferenceException на пустом пользователе.
        var second = await harness.CreateAccountController(userId)
            .DeleteAccount(new AccountController.DeleteAccountDto("Password1"), CancellationToken.None);

        AssertOk(first);
        Assert.IsType<NotFoundObjectResult>(second);
    }

    [Fact]
    public async Task DeleteAccount_UserCannotLogInAfterwards()
    {
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var userId = await harness.CreateUserAsync("reentry@example.com");
        await harness.SeedUserDataAsync(userId);

        var beforeDelete = await harness.Auth.Login(new LoginDto("reentry@example.com", "Password1"));
        Assert.IsType<OkObjectResult>(beforeDelete);

        await harness.CreateAccountController(userId)
            .DeleteAccount(new AccountController.DeleteAccountDto("Password1"), CancellationToken.None);

        var afterDelete = await harness.Auth.Login(new LoginDto("reentry@example.com", "Password1"));
        Assert.IsType<UnauthorizedObjectResult>(afterDelete);
    }

    [Fact]
    public async Task DeleteAccount_SameEmailCanRegisterAgain()
    {
        // Удаление действительно освобождает адрес: «удалённый аккаунт ещё
        // поживёт в корзине» здесь нет, и человек, передумавший через неделю,
        // возвращается тем же email.
        await using var harness = await AccountDeletionHarness.CreateAsync();
        var userId = await harness.CreateUserAsync("back@example.com");
        await harness.SeedUserDataAsync(userId);

        await harness.CreateAccountController(userId)
            .DeleteAccount(new AccountController.DeleteAccountDto("Password1"), CancellationToken.None);

        var again = await harness.Auth.Register(new RegisterDto(
            "back@example.com",
            "Password1",
            DisplayName: "Снова",
            CefrLevel: null,
            StudyGoal: null,
            DailyGoalMinutes: null));

        Assert.IsType<OkObjectResult>(again);
        Assert.NotEqual(userId, (await harness.UserManager.FindByEmailAsync("back@example.com"))!.Id);
    }

    // ── Контракт реестра: новая таблица не переживёт удаление молча ────────

    [Fact]
    public void AccountDeletion_CoversEveryTableThatHasAUserIdColumn()
    {
        var covered = AccountController.UserOwnedTables.ToHashSet(StringComparer.Ordinal);

        using var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        // CLR-тип сущности → имя свойства DbSet<T> на контексте: так список
        // проверяемых таблиц берётся из модели, а не из памяти автора теста.
        var setNames = typeof(ApplicationDbContext)
            .GetProperties()
            .Where(p => p.PropertyType.IsGenericType &&
                        p.PropertyType.GetGenericTypeDefinition() == typeof(DbSet<>))
            .ToDictionary(
                p => p.PropertyType.GetGenericArguments()[0],
                p => p.Name,
                new ReferenceEqualityComparer());

        var withUserData = context.Model.GetEntityTypes()
            .Select(e => e.ClrType)
            .Where(clr => setNames.ContainsKey(clr))
            .Where(clr => clr
                .GetProperties()
                .Any(p => p.Name is "UserId" or "UploadedByUserId"))
            .Select(clr => setNames[clr])
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.NotEmpty(withUserData);
        var missing = withUserData.Where(name => !covered.Contains(name)).ToArray();
        Assert.True(
            missing.Length == 0,
            "Таблицы с UserData удаляются не все: " + string.Join(", ", missing) +
            ". Добавьте строку в реестр AccountController.UserOwnedRows — иначе эти строки " +
            "переживут удаление аккаунта, а /privacy обещает обратное.");

        // Обратная проверка: реестр не должен протухать. Имя в нём обязано быть
        // свойством DbSet на контексте — BookKeyWords UserId не носит (это
        // дети книг), но удаляется по подзапросу, и это законно.
        var knownSets = setNames.Values.ToHashSet(StringComparer.Ordinal);
        var phantom = covered.Where(name => !knownSets.Contains(name)).ToArray();
        Assert.True(phantom.Length == 0,
            "Реестр удаления ссылается на таблицы, которых на контексте больше нет: " +
            string.Join(", ", phantom));
    }

    [Fact]
    public void AccountDeletion_NeverTouchesGuestAnalyticsEvents()
    {
        Assert.DoesNotContain("GuestAnalyticsEvents", AccountController.UserOwnedTables);
    }

    private sealed class ReferenceEqualityComparer : IEqualityComparer<Type>
    {
        public bool Equals(Type? a, Type? b) => a == b;
        public int GetHashCode(Type type) => type.GetHashCode();
    }

    /// <summary>
    /// Обходит sqlite_master и в каждой таблице с колонкой UserId /
    /// UploadedByUserId считает строки для указанного id. Возвращает список
    /// «таблица.колонка → сколько осталось».
    /// </summary>
    private static async Task<List<string>> FindRowsReferencingAsync(SqliteConnection connection, string userId)
    {
        var offenders = new List<string>();

        foreach (var table in await ReadStringsAsync(connection,
                     "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"))
        {
            var columns = await ReadColumnsAsync(connection, table);
            foreach (var column in columns.Where(c => c is "UserId" or "UploadedByUserId"))
            {
                using var command = connection.CreateCommand();
                command.CommandText =
                    $"SELECT COUNT(*) FROM \"{table.Replace("\"", "\"\"")}\" " +
                    $"WHERE \"{column.Replace("\"", "\"\"")}\" = $id";
                var parameter = command.CreateParameter();
                parameter.ParameterName = "$id";
                parameter.Value = userId;
                command.Parameters.Add(parameter);

                var count = Convert.ToInt64((await command.ExecuteScalarAsync()) ?? 0);
                if (count > 0) offenders.Add($"{table}.{column} → {count}");
            }
        }

        return offenders;
    }

    private static async Task<List<string>> ReadStringsAsync(SqliteConnection connection, string sql)
    {
        var values = new List<string>();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) values.Add(reader.GetString(0));
        return values;
    }

    // PRAGMA table_info возвращает cid, name, type, notnull, dflt_value, pk
    private static async Task<List<string>> ReadColumnsAsync(SqliteConnection connection, string table)
    {
        var columns = new List<string>();
        using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_info(\"{table.Replace("\"", "\"\"")}\")";
        using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) columns.Add(reader.GetString(1));
        return columns;
    }
}
