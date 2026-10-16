using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class AnalyticsEvent
{
    public int Id { get; set; }

    public string UserId { get; set; } = string.Empty;
    public User User { get; set; } = null!;

    [MaxLength(50)]
    public string Event { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Meta { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
