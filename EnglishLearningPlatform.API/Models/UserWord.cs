using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class UserWord
{
    public int Id { get; set; }

    public string UserId { get; set; } = string.Empty; // FK to AspNetUsers

    public int WordId { get; set; } // FK to Words

    // SM-2 алгоритм
    public int Interval { get; set; } = 0; // Интервал в днях

    public double EaseFactor { get; set; } = 2.5; // Коэффициент лёгкости (2.5 по умолчанию)

    public int RepetitionCount { get; set; } = 0; // Сколько раз повторено

    public DateTime? NextReviewDate { get; set; } // Когда повторять

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastReviewedAt { get; set; }

    [MaxLength(20)]
    public string Source { get; set; } = "manual";

    // Навигационные свойства
    public User User { get; set; } = null!;
    public Word Word { get; set; } = null!;
}