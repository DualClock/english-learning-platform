using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class XpEvent
{
    public int Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    public int Xp { get; set; }

    [MaxLength(50)]
    public string Reason { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
}
