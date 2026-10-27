using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Удаление не должно блокировать будущее.
///
/// Пока уникальный индекс по слагу категории и паре (CategoryId, English) не
/// учитывал DeletedAt, админ, удаливший категорию «Еда», не мог создать её
/// заново никогда: INSERT падал на индексе, а клиент получал 500 «an error
/// occurred while saving» — без единого намёка на причину.
///
/// Индексы теперь частичные (WHERE DeletedAt IS NULL), а контроллер при
/// повторном создании восстанавливает прежнюю строку вместо второй.
/// </summary>
public class AdminSoftDeleteReuseTests
{
    private static AdminContentController CreateController(out ApplicationDbContext context)
    {
        context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        return new AdminContentController(
            context,
            new ContentCacheInvalidator(new MemoryCache(new MemoryCacheOptions()),
                NullLogger<ContentCacheInvalidator>.Instance),
            NullLogger<AdminContentController>.Instance);
    }

    [Fact]
    public void CategorySlugIndex_IsPartial_OnDeletedAt()
    {
        // Держит схему: если фильтр у индекса пропадёт, создание категории
        // после удаления снова начнёт падать с 500.
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseNpgsql("Host=localhost;Database=probe;Username=probe;Password=probe")
                .Options);

        var index = context.Model.FindEntityType(typeof(EnglishLearningPlatform.API.Models.Category))!
            .GetIndexes()
            .Single(i => i.IsUnique && i.Properties.Any(p => p.Name == "Slug"));

        Assert.NotNull(index.GetFilter());
        Assert.Contains("DeletedAt", index.GetFilter()!, StringComparison.Ordinal);
    }

    [Fact]
    public void CategoryWordIndex_IsPartial_OnDeletedAt()
    {
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseNpgsql("Host=localhost;Database=probe;Username=probe;Password=probe")
                .Options);

        var index = context.Model.FindEntityType(typeof(EnglishLearningPlatform.API.Models.CategoryWord))!
            .GetIndexes()
            .Single(i => i.IsUnique && i.Properties.Any(p => p.Name == "CategoryId"));

        Assert.NotNull(index.GetFilter());
        Assert.Contains("DeletedAt", index.GetFilter()!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RecreatingCategoryAfterDelete_RestoresInsteadOfFailing()
    {
        var controller = CreateController(out var context);

        await controller.CreateCategory(new CategoryUpsertDto("Еда", "food", null, null, null), default);
        var original = await context.Categories.SingleAsync();

        await controller.DeleteCategory(original.Id, default);
        Assert.Empty(await context.Categories.ToListAsync());

        // Тот же слаг после удаления — нормальный сценарий, а не конфликт.
        var again = await controller.CreateCategory(
            new CategoryUpsertDto("Еда", "food", "🍎", null, "заново"), default);

        Assert.IsType<OkObjectResult>(again.Result);

        var live = await context.Categories.ToListAsync();
        Assert.Single(live);
        Assert.Equal(original.Id, live[0].Id);  // восстановлена прежняя строка
        Assert.Equal("🍎", live[0].Icon);
    }

    [Fact]
    public async Task RecreatingCategoryWhileActive_StillConflicts()
    {
        var controller = CreateController(out _);

        await controller.CreateCategory(new CategoryUpsertDto("Еда", "food", null, null, null), default);
        var again = await controller.CreateCategory(
            new CategoryUpsertDto("Еда", "food", null, null, null), default);

        Assert.IsType<ConflictObjectResult>(again.Result);
    }

    [Fact]
    public async Task RecreatingWordAfterDelete_RestoresIt()
    {
        var controller = CreateController(out var context);

        await controller.CreateCategory(new CategoryUpsertDto("Еда", "food", null, null, null), default);
        var category = await context.Categories.SingleAsync();
        var dto = new CategoryWordUpsertDto("apple", "яблоко", null, null);

        await controller.CreateWord(category.Id, dto, default);
        var word = await context.CategoryWords.SingleAsync();
        await controller.DeleteWord(word.Id, default);

        var again = await controller.CreateWord(category.Id, dto, default);

        Assert.IsType<OkObjectResult>(again.Result);
        Assert.Single(await context.CategoryWords.ToListAsync());
    }
}
