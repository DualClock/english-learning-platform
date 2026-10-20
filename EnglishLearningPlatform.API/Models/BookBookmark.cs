using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>Закладка читалки: страница книги и короткая заметка к ней.</summary>
public class BookBookmark
{
    public int Id { get; set; }

    public int BookId { get; set; }

    public string UserId { get; set; } = string.Empty;

    public int Page { get; set; }

    [MaxLength(500)]
    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Book? Book { get; set; }
    public User? User { get; set; }
}
