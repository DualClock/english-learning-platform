using EnglishLearningPlatform.API.Services.Guest;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Единая точка сброса кэшей контента.
///
/// Зачем отдельный сервис, а не `_cache.Remove(...)` в каждом контроллере:
/// витрин три (публичный каталог, гостевой каталог, превью книги), и каждая
/// живёт в своём ключе со своим TTL. Пока админских правок не было, кэш мог
/// себе позволить жить шесть часов; теперь «админ поправил книгу» обязан быть
/// видно сразу, а не после истечения TTL.
///
/// Ключи собраны здесь, а не у владельцев кэша, потому что вызывающий —
/// админский код — не должен знать, кто и где кэширует. Если завтра появится
/// четвёртая витрина, забыть её можно ровно в одном месте.
/// </summary>
public class ContentCacheInvalidator
{
    private readonly IMemoryCache _cache;
    private readonly ILogger<ContentCacheInvalidator> _logger;

    public ContentCacheInvalidator(IMemoryCache cache, ILogger<ContentCacheInvalidator> logger)
    {
        _cache = cache;
        _logger = logger;
    }

    /// <summary>
    /// Книги и обложки: каталог библиотеки, гостевые книги, превью глав.
    /// </summary>
    public void InvalidateBooks(int? bookId = null)
    {
        _cache.Remove(PublicCatalogService.CatalogCacheKey);
        _cache.Remove(GuestReaderCatalog.CatalogCacheKey);
        _cache.Remove(PopularBooksService.PopularCoversCacheKey);

        // Превью хранится по книге: снимаем конкретную, чтобы не сбрасывать
        // сотню остальных из-за правки одной.
        if (bookId is { } id)
        {
            _cache.Remove(PublicCatalogService.PreviewCacheKeyPrefix + id);
        }

        _logger.LogInformation(
            "Сброшены кэши книг (book={BookId}) — изменение видно сразу",
            bookId?.ToString() ?? "все");
    }

    /// <summary>
    /// Категории и слова в них. Отдельный метод, а не общий: сброс всех кэшей
    /// на каждую правку слова — это лишняя пересборка EPUB-превью.
    /// </summary>
    public void InvalidateCategories()
    {
        // Категории в кэшах витрин не участвуют (они читаются запросом к БД),
        // но публичный каталог может отдавать уровень книги по словам.
        // Пересборка дешёвая — один запрос к БД.
        _cache.Remove(PublicCatalogService.CatalogCacheKey);

        _logger.LogInformation("Сброшены кэши категорий — изменение видно сразу");
    }

    /// <summary>
    /// Всё сразу. Используется служебными операциями (сиды, импорт), где
    /// затронуто неизвестно что.
    /// </summary>
    public void InvalidateAll()
    {
        InvalidateBooks();
        InvalidateCategories();

        // Кэш словарных статей (DictionaryService) живёт внутри сервиса и
        // пересчитывается по ключу слова; сбрасывать его целиком не нужно.
    }
}
