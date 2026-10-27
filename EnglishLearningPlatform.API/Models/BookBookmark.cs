using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Закладка читалки. Новые закладки живут на предложении, а не на странице:
/// после смены кегля страница другая, а место в тексте — то же.
/// Page остаётся для старых закладок и совместимости на один релиз.
/// </summary>
public class BookBookmark
{
    public int Id { get; set; }

    public int BookId { get; set; }

    public string UserId { get; set; } = string.Empty;

    public int? Page { get; set; }

    [MaxLength(80)]
    public string? ChapterId { get; set; }

    [MaxLength(80)]
    public string? SentenceId { get; set; }

    public int CharOffset { get; set; }

    [MaxLength(500)]
    public string? Excerpt { get; set; }

    [MaxLength(500)]
    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Book? Book { get; set; }
    public User? User { get; set; }
}
