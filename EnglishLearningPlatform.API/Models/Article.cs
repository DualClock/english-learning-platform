using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Раздел статей: постоянная рубрика — «Грамматика», «Лексика», «Разборы».
///
/// Отдельная сущность от <see cref="Category"/>: Category — это набор СЛОВ для
/// изучения, к ней привязаны прогресс и карточки пользователя. ArticleSection —
/// рубрика для текстов. Слить их значит получить таблицу, где половина строк
/// описывает слова, а половина — статьи, и любой запрос начинается с «а какого
/// ты типа».
/// </summary>
public class ArticleSection : ISoftDeletable
{
    public int Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    /// <summary>Человекочитаемый адрес: /articles/grammar</summary>
    [Required]
    [MaxLength(100)]
    public string Slug { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Description { get; set; }

    /// <summary>Порядок в списке разделов. По умолчанию — по алфавиту было бы хаотично.</summary>
    public int SortOrder { get; set; }

    public DateTime? DeletedAt { get; set; }

    public string? DeletedByUserId { get; set; }

    public ICollection<Article> Articles { get; set; } = new List<Article>();
}

/// <summary>
/// Статья — постоянный материал, который пишется и живёт годами.
///
/// В отличие от новости у неё есть редактор (markdown), статус и ревизии:
/// статья переписывается, и «что было раньше» — вопрос, который задаётся.
/// </summary>
public class Article : ISoftDeletable
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Slug { get; set; } = string.Empty;

    [Required]
    [MaxLength(300)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(1000)]
    public string? Summary { get; set; }

    /// <summary>
    /// Тело в markdown. Храним источник, а не HTML: HTML — производное, его
    /// можно перегенерировать при смене рендерера, а markdown останется.
    /// </summary>
    public string BodyMarkdown { get; set; } = string.Empty;

    /// <summary>
    /// Кэш отрендеренного и очищенного HTML. Пересчитывается при сохранении,
    /// чтобы не санитизировать на каждый показ страницы.
    /// </summary>
    public string BodyHtml { get; set; } = string.Empty;

    public int? SectionId { get; set; }

    /// <summary>
    /// draft — видно только админу; published — на сайте; archived — снято с
    /// сайта, но не удалено (ссылки из старых постов продолжают работать).
    /// </summary>
    [Required]
    [MaxLength(20)]
    public string Status { get; set; } = ArticleStatus.Draft;

    public string? AuthorId { get; set; }

    /// <summary>Когда статья впервые вышла. У черновика null.</summary>
    public DateTime? PublishedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? DeletedAt { get; set; }

    public string? DeletedByUserId { get; set; }

    public ArticleSection? Section { get; set; }

    public ICollection<ArticleRevision> Revisions { get; set; } = new List<ArticleRevision>();
}

/// <summary>
/// Снимок статьи до правки.
///
/// Без ревизий «админ случайно затёр текст» — это потеря контента без
/// возможности откатиться. Храним снимок каждой сохранённой версии: объём
/// текста небольшой, а восстановление иначе невозможно.
/// </summary>
public class ArticleRevision
{
    public int Id { get; set; }

    public int ArticleId { get; set; }

    /// <summary>Номер версии по порядку, начиная с 1.</summary>
    public int Revision { get; set; }

    [Required]
    [MaxLength(300)]
    public string Title { get; set; } = string.Empty;

    public string BodyMarkdown { get; set; } = string.Empty;

    [MaxLength(20)]
    public string Status { get; set; } = ArticleStatus.Draft;

    public string? EditedByUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Article Article { get; set; } = null!;
}

/// <summary>
/// Имена статусов — константами, а не строками по коду.
/// Опечатка в "pubished" иначе даёт статью, которую не видит никто.
/// </summary>
public static class ArticleStatus
{
    public const string Draft = "draft";
    public const string Published = "published";
    public const string Archived = "archived";

    public static readonly string[] All = { Draft, Published, Archived };

    public static bool IsValid(string? status) =>
        status != null && All.Contains(status, StringComparer.Ordinal);
}
