using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Слово, которое читатель открыл в книге. Это ещё не карточка повторения:
/// в SRS оно попадает только после разбора главы или явного «учить».
/// </summary>
public class ReaderPocketWord
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

    [Required]
    [MaxLength(100)]
    public string Word { get; set; } = string.Empty;

    /// <summary>Нижний регистр без притяжательного 's — ключ дедупликации.</summary>
    [Required]
    [MaxLength(100)]
    public string NormalizedWord { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? SentenceText { get; set; }

    [MaxLength(500)]
    public string? TranslationRu { get; set; }

    [MaxLength(50)]
    public string? PartOfSpeech { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;

    /// <summary>Когда слово ушло в словарь и SRS. null — ещё в кармане.</summary>
    public DateTime? PromotedAt { get; set; }

    /// <summary>Когда читатель сказал «уже знаю». В разборе такое слово не показываем.</summary>
    public DateTime? KnownAt { get; set; }

    public Book? Book { get; set; }
    public User? User { get; set; }
}
