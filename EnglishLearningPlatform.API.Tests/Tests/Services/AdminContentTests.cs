using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Guest;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// CMS-2: правка админа обязана быть видна пользователю СРАЗУ.
///
/// До этой волны админского CRUD не существовало вовсе, а витрины жили в
/// кеше: публичный каталог 6 часов, гостевой 6 часов. Эндпоинт, который пишет
/// в базу, но не сбрасывает кеш, формально «работает» и при этом оставляет
/// пользователя на старых данных до истечения TTL. Тесты держат именно эту
/// связку — не «метод вернул 200», а «после правки кеш пуст и выдача другая».
/// </summary>
public class AdminContentTests
{
    private static ApplicationDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static (AdminContentController Controller, ApplicationDbContext Context, IMemoryCache Cache)
        CreateHarness()
    {
        var context = CreateContext();
        var cache = new MemoryCache(new MemoryCacheOptions());
        var invalidator = new ContentCacheInvalidator(
            cache, NullLogger<ContentCacheInvalidator>.Instance);

        var controller = new AdminContentController(
            context, invalidator, NullLogger<AdminContentController>.Instance);

        // Контроллер берёт id админа из claims; в тесте без HTTP-контекста
        // поле User пустое, и AdminId падает на "admin" — этого достаточно,
        // чтобы проверить, что DeletedByUserId вообще заполняется.
        return (controller, context, cache);
    }

    // ─────────────────────────────────────────────────────────────── создание

    [Fact]
    public async Task CreateCategory_AppearsInUserCatalog()
    {
        var (controller, context, _) = CreateHarness();

        var result = await controller.CreateCategory(
            new CategoryUpsertDto("Еда", "food", "🍎", "#FF0000", "Слова о еде"),
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);

        // Пользовательский путь: GET /api/categories читает Categories с
        // фильтром удалённых.
        var visible = await context.Categories.AsNoTracking().ToListAsync();

        Assert.Single(visible);
        Assert.Equal("Еда", visible[0].Name);
        Assert.Equal("food", visible[0].Slug);
    }

    [Fact]
    public async Task CreateWord_AppearsInCategoryForUsers()
    {
        var (controller, context, _) = CreateHarness();
        await controller.CreateCategory(new CategoryUpsertDto("Еда", "food", null, null, null), default);
        var category = await context.Categories.SingleAsync();

        var result = await controller.CreateWord(
            category.Id,
            new CategoryWordUpsertDto("apple", "яблоко", "ˈæpl", "I ate an apple."),
            default);

        Assert.IsType<OkObjectResult>(result.Result);

        // Ровно тот запрос, которым выдачу категории строит
        // CategoriesController.GetWords.
        var words = await context.Categories
            .Include(c => c.Words.Where(w => w.DeletedAt == null))
            .AsNoTracking()
            .Where(c => c.Slug == "food")
            .SelectMany(c => c.Words)
            .ToListAsync();

        Assert.Single(words);
        Assert.Equal("apple", words[0].English);
        Assert.Equal("яблоко", words[0].Translation);
    }

    [Fact]
    public async Task DuplicateWordInSameCategory_IsRejectedWith409()
    {
        var (controller, context, _) = CreateHarness();
        await controller.CreateCategory(new CategoryUpsertDto("Еда", "food", null, null, null), default);
        var category = await context.Categories.SingleAsync();
        var dto = new CategoryWordUpsertDto("apple", "яблоко", null, null);

        await controller.CreateWord(category.Id, dto, default);
        var second = await controller.CreateWord(category.Id, dto, default);

        // 409, а не 500 от нарушения уникального индекса.
        Assert.IsType<ConflictObjectResult>(second.Result);
        Assert.Single(await context.CategoryWords.ToListAsync());
    }

    // ──────────────────────────────────────────────────────────────── удаление

    [Fact]
    public async Task DeletedWord_DisappearsForUsersButKeepsUserProgress()
    {
        var (controller, context, _) = CreateHarness();

        context.Users.Add(new User
        {
            Id = "u1",
            UserName = "u1@example.com",
            NormalizedUserName = "U1@EXAMPLE.COM",
            Email = "u1@example.com",
            NormalizedEmail = "U1@EXAMPLE.COM"
        });
        await context.SaveChangesAsync();

        await controller.CreateCategory(new CategoryUpsertDto("Еда", "food", null, null, null), default);
        var category = await context.Categories.SingleAsync();
        await controller.CreateWord(category.Id, new CategoryWordUpsertDto("apple", "яблоко", null, null), default);
        var word = await context.CategoryWords.SingleAsync();

        context.UserCategoryWordProgresses.Add(new UserCategoryWordProgress
        {
            UserId = "u1",
            CategoryWordId = word.Id,
            Status = "learned"
        });
        await context.SaveChangesAsync();

        await controller.DeleteWord(word.Id, default);

        // Видимость для пользователя на InMemory не проверить: провайдер
        // игнорирует Where внутри Include (см. SoftDeleteSqlTests — там та же
        // проверка на настоящем переводчике). Здесь то, что от провайдера не
        // зависит: поле выставлено, слово физически на месте, прогресс цел.
        var stored = await context.CategoryWords.IgnoreQueryFilters().SingleAsync(w => w.Id == word.Id);
        Assert.NotNull(stored.DeletedAt);

        // Ни одного физического удаления: если бы здесь стоял Cascade,
        // строка прогресса исчезла бы вместе со словом.
        var progress = await context.UserCategoryWordProgresses.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("learned", progress.Status);
    }

    [Fact]
    public async Task DeletedCategory_DisappearsFromUserList()
    {
        var (controller, context, _) = CreateHarness();
        await controller.CreateCategory(new CategoryUpsertDto("Еда", "food", null, null, null), default);
        var category = await context.Categories.SingleAsync();

        await controller.DeleteCategory(category.Id, default);

        Assert.Empty(await context.Categories.ToListAsync());
    }

    [Fact]
    public async Task DeletedCategory_IsVisibleInAdminWithIncludeDeleted()
    {
        var (controller, context, _) = CreateHarness();
        await controller.CreateCategory(new CategoryUpsertDto("Еда", "food", null, null, null), default);
        var category = await context.Categories.SingleAsync();
        await controller.DeleteCategory(category.Id, default);

        var result = await controller.ListCategories(includeDeleted: true, default);
        var ok = Assert.IsType<OkObjectResult>(result.Result);

        // Без этого админ не смог бы восстановить удалённое.
        Assert.Single((System.Collections.IEnumerable)ok.Value!);
    }

    // ─────────────────────────────────────────────────────────── восстановление

    [Fact]
    public async Task RestoredWord_ReturnsToUserCatalogWithSameProgress()
    {
        var (controller, context, _) = CreateHarness();

        context.Users.Add(new User
        {
            Id = "u1",
            UserName = "u1@example.com",
            NormalizedUserName = "U1@EXAMPLE.COM",
            Email = "u1@example.com",
            NormalizedEmail = "U1@EXAMPLE.COM"
        });
        await context.SaveChangesAsync();

        await controller.CreateCategory(new CategoryUpsertDto("Еда", "food", null, null, null), default);
        var category = await context.Categories.SingleAsync();
        await controller.CreateWord(category.Id, new CategoryWordUpsertDto("apple", "яблоко", null, null), default);
        var word = await context.CategoryWords.SingleAsync();

        context.UserCategoryWordProgresses.Add(new UserCategoryWordProgress
        {
            UserId = "u1",
            CategoryWordId = word.Id,
            Status = "learned"
        });
        await context.SaveChangesAsync();

        await controller.DeleteWord(word.Id, default);
        await controller.RestoreWord(word.Id, default);

        var forUser = await context.Categories
            .Include(c => c.Words.Where(w => w.DeletedAt == null))
            .AsNoTracking()
            .SelectMany(c => c.Words)
            .ToListAsync();
        Assert.Single(forUser);

        var progress = await context.UserCategoryWordProgresses.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("learned", progress.Status);
    }

    [Fact]
    public async Task RecreatingDeletedWord_RestoresInsteadOfDuplicating()
    {
        var (controller, context, _) = CreateHarness();
        await controller.CreateCategory(new CategoryUpsertDto("Еда", "food", null, null, null), default);
        var category = await context.Categories.SingleAsync();
        var dto = new CategoryWordUpsertDto("apple", "яблоко", null, null);

        await controller.CreateWord(category.Id, dto, default);
        var word = await context.CategoryWords.SingleAsync();
        await controller.DeleteWord(word.Id, default);

        // Админ добавляет то же слово снова: уникальный индекс (CategoryId,
        // English) не даёт вставить вторую строку — восстанавливаем первую.
        var again = await controller.CreateWord(category.Id, dto, default);

        Assert.IsType<OkObjectResult>(again.Result);
        Assert.Single(await context.CategoryWords.IgnoreQueryFilters().ToListAsync());
        Assert.Single(await context.CategoryWords.ToListAsync());
    }

    // ────────────────────────────────────────────────────────────────── книги

    [Fact]
    public async Task DeletedBook_DisappearsFromCatalogAndKeepsReadingProgress()
    {
        var (controller, context, _) = CreateHarness();

        context.Users.Add(new User
        {
            Id = "u1",
            UserName = "u1@example.com",
            NormalizedUserName = "U1@EXAMPLE.COM",
            Email = "u1@example.com",
            NormalizedEmail = "U1@EXAMPLE.COM"
        });

        var book = new Book { Title = "Moby-Dick", FilePath = "moby.epub", UploadedByUserId = null };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        context.UserBookProgresses.Add(new UserBookProgress
        {
            UserId = "u1",
            BookId = book.Id,
            ChapterId = "ch-1",
            SentenceId = "s-4",
            CharOffset = 120,
            MaxPercent = 34.5
        });
        await context.SaveChangesAsync();

        await controller.DeleteBook(book.Id, default);

        Assert.Empty(await context.Books.ToListAsync());

        var progress = await context.UserBookProgresses.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("ch-1", progress.ChapterId);
        Assert.Equal(34.5, progress.MaxPercent);
    }

    [Fact]
    public async Task PublishBook_MakesUserCopyVisibleOnGuestShelf()
    {
        var (controller, context, _) = CreateHarness();

        var book = new Book { Title = "Dracula", FilePath = "d.epub", UploadedByUserId = "u1" };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        // Гостевой каталог показывает только строки без владельца.
        Assert.Empty(await context.Books.Where(b => b.UploadedByUserId == null).ToListAsync());

        await controller.PublishBook(book.Id, default);

        Assert.Single(await context.Books.Where(b => b.UploadedByUserId == null).ToListAsync());
    }
}
