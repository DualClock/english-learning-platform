using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// История повторений — нужна для статистики (retention, прогноз нагрузки)
/// и для отладки расписания SRS.
/// </summary>
public class ReviewLog
{
    public long Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    public int WordId { get; set; }

    /// <summary>Оценка 1–5 (1 — забыл, 5 — легко).</summary>
    public int Quality { get; set; }

    public int PreviousInterval { get; set; }

    public int NewInterval { get; set; }

    public double EaseFactor { get; set; }

    public DateTime ReviewedAt { get; set; } = DateTime.UtcNow;

    public User? User { get; set; }
}
