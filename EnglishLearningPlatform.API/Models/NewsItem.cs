using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Новость англоязычного источника — текучка, а не контент, который пишут руками.
///
/// Отличается от <see cref="Article"/> по природе, а не по форме:
///
///  1. Приходит извне. <see cref="ExternalId"/> — ключ дедупликации: один и
///     тот же материал при следующей синхронизации не должен создавать вторую
///     строку. У статьи такого поля нет и быть не может.
///  2. Живёт недолго. Новость трёхмесячной давности никому не нужна, её можно
///     чистить по <see cref="PublishedAt"/>; статью — нельзя.
///  3. Уровень приходит готовым от источника (News in Levels помечает его в
///     заголовке). Вычислять его мы не обязаны.
///
/// Текст хранится уже очищенным HTML: санитайзер применяется при записи, чтобы
/// чужой скрипт из фида не попал в базу и не отдавался читателю.
/// </summary>
public class NewsItem
{
    public int Id { get; set; }

    /// <summary>
    /// Ключ дедупликации: стабильный хэш от канонического адреса материала.
    /// Уникальный индекс в базе — единственная защита от дублей при повторной
    /// синхронизации, включая случай двух параллельных запусков фетчера.
    /// </summary>
    [Required]
    [MaxLength(64)]
    public string ExternalId { get; set; } = string.Empty;

    [Required]
    [MaxLength(300)]
    public string Title { get; set; } = string.Empty;

    /// <summary>Короткий анонс для карточки. Обязателен: без него карточка пустая.</summary>
    [Required]
    [MaxLength(1000)]
    public string Summary { get; set; } = string.Empty;

    /// <summary>Тело материала. Уже прошло через HtmlSanitizer при записи.</summary>
    public string BodyHtml { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string SourceName { get; set; } = string.Empty;

    /// <summary>Ссылка на первоисточник: новость не перепечатываем, даём переход.</summary>
    [Required]
    [MaxLength(1000)]
    public string SourceUrl { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? ImageUrl { get; set; }

    /// <summary>
    /// Уровень сложности: A1, A2, B1, B2, C1. Приходит от источника.
    /// null — источник не размечает; такая новость не попадает в персональную
    /// выдачу, но остаётся в общем списке (лучше не показать, чем показать
    /// C1 первогодке).
    /// </summary>
    [MaxLength(2)]
    public string? Level { get; set; }

    /// <summary>
    /// Темы через запятую: «news,sport,science». Массивом не делаем — фильтр
    /// по интересам у нас небольшой, а text[] в Npgsql усложняет запросы на
    /// порядок ради выигрыша, которого на десятках строк не существует.
    /// </summary>
    [MaxLength(300)]
    public string Topics { get; set; } = string.Empty;

    /// <summary>Когда материал опубликован у источника.</summary>
    public DateTime PublishedAt { get; set; }

    /// <summary>Когда мы его забрали. По этому полю считается свежесть синхронизации.</summary>
    public DateTime FetchedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Скрыто админом. Не удаляем: дедупликация должна помнить про этот
    /// материал, иначе следующий опрос вернёт его снова.
    /// </summary>
    public bool IsHidden { get; set; }
}
