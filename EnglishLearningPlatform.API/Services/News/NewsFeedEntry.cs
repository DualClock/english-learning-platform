namespace EnglishLearningPlatform.API.Services.News;

/// <summary>
/// Нормализованная запись фида — то, что источник умеет отдать, и всё, что
/// нужно фетчеру для записи в NewsItem.
///
/// Это DTO из фида, а не сущность БД: у неё нет ни Id, ни признаков скрытия и
/// удаления, потому что решает их фетчер по своему состоянию базы. Отдельный
/// тип держит парсер источника вдали от DbContext — иначе скрейпер RSS
/// пришлось бы тянуть в тесты вместе с Postgres.
///
/// record, а не класс: это данные без поведения, сравнение по значению
/// приходит из коробки и пригодится тестам.
///
/// PublishedAt — время источника. Заполняется всегда: если у фида даты нет,
/// источник подставляет время получения, иначе чистка по возрасту не может
/// отделить свежее от старого.
/// </summary>
public record NewsFeedEntry(
    string Title,
    string Summary,
    string BodyHtml,
    string SourceName,
    string SourceUrl,
    string? ImageUrl,
    string? Level,
    string[] Topics,
    DateTime PublishedAt);
