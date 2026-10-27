using EnglishLearningPlatform.API.Services;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// Полный текст книги кладётся в IMemoryCache без ограничения размера.
/// Несколько больших EPUB могут занять сотни мегабайт и уронить инстанс,
/// поэтому кэшируем только книги в разумном бюджете.
/// </summary>
public class BookCacheBudgetTests
{
    [Fact]
    public void ShouldCacheText_SmallBook_ReturnsTrue() =>
        Assert.True(BookService.ShouldCacheText(BookService.MaxCachedTextChars));

    [Fact]
    public void ShouldCacheText_OversizedBook_ReturnsFalse() =>
        Assert.False(BookService.ShouldCacheText(BookService.MaxCachedTextChars + 1L));
}
