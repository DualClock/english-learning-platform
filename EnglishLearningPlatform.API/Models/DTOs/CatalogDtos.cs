namespace EnglishLearningPlatform.API.Models.DTOs;

/// <summary>
/// Единственный формат, который анонимный каталог отдаёт наружу.
///
/// Список полей исчерпывающий и проверяется тестом: в нём нет ни
/// <c>FilePath</c> (путь к EPUB в наших uploads), ни <c>UploadedByUserId</c>
/// (чей это экземпляр книги), ни прогресса/чужих взаимодействий. Тип — record
/// с позитивным списком полей, а не анонимный объект из модели: так «случайно
/// пробросить новое приватное поле» невозможно в принципе — его надо вписать
/// сюда руками, и тогда его увидит ревью.
/// </summary>
public sealed record PublicBookDto(
    string Slug,
    string Title,
    string? Author,
    string? CefrLevel,
    // "classic" (публичное достояние с Gutenberg) или "story" (наш градированный рассказ)
    string Kind,
    string? Description,
    // Объём в словах. null — если мы этого не знаем, а не «в книге ноль слов»
    int? WordCount,
    string? CoverUrl,
    string? GutenbergId,
    // Короткое начало книги (см. PublicCatalogService.PreviewWordLimit); null, если текста нет
    string? Preview);

/// <summary>Ответ GET /api/catalog/books.</summary>
public sealed record CatalogResponse(int Count, IReadOnlyList<PublicBookDto> Books);

/// <summary>Ответ GET /api/catalog/books/{slug} — та же запись без обёртки списка.</summary>
public sealed record CatalogBookResponse(PublicBookDto Book);
