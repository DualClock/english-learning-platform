using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class UserWord
{
    public int Id { get; set; }

    public string UserId { get; set; } = string.Empty; // FK to AspNetUsers

    public int WordId { get; set; } // FK to Words

    // SM-2 алгоритм
    public int Interval { get; set; } = 0; // Интервал в днях (для «выученных» карточек)

    public int IntervalMinutes { get; set; } = 0; // Интервал в минутах (learning steps)

    public double EaseFactor { get; set; } = 2.5; // Коэффициент лёгкости (2.5 по умолчанию)

    public int RepetitionCount { get; set; } = 0; // Сколько раз повторено

    public int Lapses { get; set; } = 0; // Сколько раз забывал

    public int? LastQuality { get; set; } // Последняя оценка 1–5

    public bool IsLeech { get; set; } = false; // «Проблемное» слово (много срывов)

    public DateTime? NextReviewDate { get; set; } // Когда повторять

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastReviewedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    [MaxLength(20)]
    public string Source { get; set; } = "manual";

    // Личный визуал слова: эмодзи или приватная картинка. Хранится на UserWord,
    // а не на общем Word, чтобы чужие карточки не менялись.
    [MaxLength(32)]
    public string? Emoji { get; set; }

    [MaxLength(500)]
    public string? ImageUrl { get; set; }

    // Навигационные свойства
    public User User { get; set; } = null!;
    public Word Word { get; set; } = null!;
}