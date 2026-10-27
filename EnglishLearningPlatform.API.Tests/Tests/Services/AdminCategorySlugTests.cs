using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Слаги категорий.
///
/// Название категории у нас почти всегда русское. Пока кириллица просто
/// выбрасывалась, «Еда» превращалась в пустую строку, а «Проверка UI» —
/// в «проверка-ui»: ссылка в браузере приходила процентно-закодированной,
/// её нельзя ни прочитать, ни набрать руками, и она ломается при копировании.
/// </summary>
public class AdminCategorySlugTests
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

    private static async Task<string> SlugFor(string name, string? slug = null)
    {
        var controller = CreateController(out var context);
        await controller.CreateCategory(new CategoryUpsertDto(name, slug, null, null, null), default);
        return (await context.Categories.SingleAsync()).Slug;
    }

    [Fact]
    public async Task CyrillicName_IsTransliterated()
    {
        Assert.Equal("eda", await SlugFor("Еда"));
    }

    [Fact]
    public async Task MixedCyrillicAndLatin_ProducesCleanSlug()
    {
        var slug = await SlugFor("Проверка UI");

        Assert.Equal("proverka-ui", slug);
        // Только ASCII: ссылку можно набрать и скопировать.
        Assert.All(slug, ch => Assert.True(ch < 128, $"не-ASCII символ в слаге: {slug}"));
    }

    [Fact]
    public async Task HardSignAndSoftSign_AreDropped()
    {
        // Твёрдый и мягкий знаки просто выпадают: «Объявление» → obyavlenie,
        // «Моль» → mol. Дефис на их месте читался бы как граница слова.
        Assert.Equal("obyavlenie", await SlugFor("Объявление"));
        Assert.Equal("mol", await SlugFor("Моль"));
    }

    [Fact]
    public async Task ExplicitSlug_WinsOverName()
    {
        Assert.Equal("custom-slug", await SlugFor("Имя категории", "custom-slug"));
    }

    [Fact]
    public async Task EmojiOnlyName_GetsFallbackSlug()
    {
        // Имя из одних эмодзи не даёт ни одного ASCII-символа. Пустой слаг
        // нарушил бы NOT NULL и уникальный индекс — подставляем fallback.
        var slug = await SlugFor("🎉🎉🎉");

        Assert.StartsWith("cat-", slug, StringComparison.Ordinal);
        Assert.True(slug.Length > 4);
    }

    [Fact]
    public async Task DuplicateSlug_IsRejectedWith409()
    {
        var controller = CreateController(out _);
        await controller.CreateCategory(new CategoryUpsertDto("Еда", null, null, null, null), default);

        var again = await controller.CreateCategory(
            new CategoryUpsertDto("Еда", null, null, null, null), default);

        Assert.IsType<ConflictObjectResult>(again.Result);
    }
}
