using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Guest;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Первая половина требования «правка админа видна пользователю сразу»:
/// кэш витрин действительно сбрасывается.
///
/// Кэш здесь — единственное звено между админской записью в БД и читателем.
/// Публичный каталог живёт 6 часов, гостевой — 6 часов, превью глав — 12.
/// Если инвалидатор не вызван (или забыл один из ключей), админ сохраняет
/// правку, получает 200, а пользователь видит старую книгу до истечения TTL.
/// Ошибка немая: ни исключения, ни лога, только «не работает и непонятно почему».
/// </summary>
public class ContentCacheInvalidatorTests
{
    private static (ContentCacheInvalidator Invalidator, IMemoryCache Cache) Create()
    {
        var cache = new MemoryCache(new MemoryCacheOptions());
        return (new ContentCacheInvalidator(cache, NullLogger<ContentCacheInvalidator>.Instance), cache);
    }

    private static void Seed(IMemoryCache cache)
    {
        cache.Set(PublicCatalogService.CatalogCacheKey, "catalog");
        cache.Set(GuestReaderCatalog.CatalogCacheKey, "guest");
        cache.Set(PopularBooksService.PopularCoversCacheKey, "covers");
        cache.Set(PublicCatalogService.PreviewCacheKeyPrefix + 7, "preview-7");
        cache.Set(PublicCatalogService.PreviewCacheKeyPrefix + 8, "preview-8");
        cache.Set("unrelated-key", "stays");
    }

    [Fact]
    public void InvalidateBooks_DropsAllThreeBookViews()
    {
        var (invalidator, cache) = Create();
        Seed(cache);

        invalidator.InvalidateBooks();

        Assert.False(cache.TryGetValue(PublicCatalogService.CatalogCacheKey, out _));
        Assert.False(cache.TryGetValue(GuestReaderCatalog.CatalogCacheKey, out _));
        Assert.False(cache.TryGetValue(PopularBooksService.PopularCoversCacheKey, out _));
    }

    [Fact]
    public void InvalidateBooks_WithBookId_DropsOnlyThatPreview()
    {
        var (invalidator, cache) = Create();
        Seed(cache);

        invalidator.InvalidateBooks(bookId: 7);

        Assert.False(cache.TryGetValue(PublicCatalogService.PreviewCacheKeyPrefix + 7, out _));

        // Превью соседней книги не пересобирается: это распаковка EPUB,
        // десятки миллисекунд на каждую.
        Assert.True(cache.TryGetValue(PublicCatalogService.PreviewCacheKeyPrefix + 8, out _));
    }

    [Fact]
    public void InvalidateCategories_DropsPublicCatalog()
    {
        var (invalidator, cache) = Create();
        Seed(cache);

        invalidator.InvalidateCategories();

        Assert.False(cache.TryGetValue(PublicCatalogService.CatalogCacheKey, out _));
    }

    [Fact]
    public void Invalidate_DoesNotTouchUnrelatedKeys()
    {
        // Инвалидатор не должен быть «снести весь IMemoryCache»: там же лежат
        // квоты AI, счётчики регистрации и лимиты писем. Их сброс — это
        // обнуление защиты от брутфорса.
        var (invalidator, cache) = Create();
        Seed(cache);

        invalidator.InvalidateAll();

        Assert.True(cache.TryGetValue("unrelated-key", out var value));
        Assert.Equal("stays", value);
    }

    [Fact]
    public void InvalidateAll_DropsEverythingContentRelated()
    {
        var (invalidator, cache) = Create();
        Seed(cache);

        invalidator.InvalidateAll();

        Assert.False(cache.TryGetValue(PublicCatalogService.CatalogCacheKey, out _));
        Assert.False(cache.TryGetValue(GuestReaderCatalog.CatalogCacheKey, out _));
        Assert.False(cache.TryGetValue(PopularBooksService.PopularCoversCacheKey, out _));
    }
}
