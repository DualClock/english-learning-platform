using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Банк типичных ошибок ученика: сюда попадают разборы Alex,
/// чтобы к одной и той же ошибке можно было вернуться и отметить её исправленной.
/// </summary>
public class UserErrorBankEntry
{
    public int Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    [MaxLength(500)]
    public string Original { get; set; } = string.Empty;

    [MaxLength(500)]
    public string Suggestion { get; set; } = string.Empty;

    [MaxLength(30)]
    public string Type { get; set; } = "grammar";

    [MaxLength(1000)]
    public string? Explanation { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // null — ошибка ещё не отработана
    public DateTime? ResolvedAt { get; set; }

    public User? User { get; set; }
}
