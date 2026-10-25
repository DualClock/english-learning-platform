using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Точное место чтения. Номер страницы здесь не живёт: после смены кегля
/// страницы другие, а предложение и символ в нём остаются теми же.
/// </summary>
public class UserBookProgress
{
    public int Id { get; set; }

    [Required]
    public string UserId { get; set; } = string.Empty;

    public int BookId { get; set; }

    [Required]
    [MaxLength(80)]
    public string ChapterId { get; set; } = string.Empty;

    [Required]
    [MaxLength(80)]
    public string SentenceId { get; set; } = string.Empty;

    public int CharOffset { get; set; }

    /// <summary>Максимальная доля книги, до которой дошёл читатель. Не убывает.</summary>
    public double MaxPercent { get; set; }

    public DateTime PositionUpdatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? FinishedAt { get; set; }

    public Book? Book { get; set; }
    public User? User { get; set; }
}
