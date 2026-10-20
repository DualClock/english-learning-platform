using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>Разблокированное пользователем достижение.</summary>
public class UserAchievement
{
    public int Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    [MaxLength(50)]
    public string Code { get; set; } = string.Empty;

    public DateTime UnlockedAt { get; set; } = DateTime.UtcNow;

    public User? User { get; set; }
}
