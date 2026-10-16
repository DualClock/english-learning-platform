using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.AspNetCore.Identity;

namespace EnglishLearningPlatform.API.Models;

public class User : IdentityUser
{
    public string? DisplayName { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastLoginAt { get; set; }

    // Профиль и геймификация
    [MaxLength(2)]
    public string? CefrLevel { get; set; }

    [MaxLength(200)]
    public string? StudyGoal { get; set; }

    public int DailyGoalMinutes { get; set; } = 10;

    public int CurrentStreak { get; set; } = 0;

    public int LongestStreak { get; set; } = 0;

    [Column(TypeName = "date")]
    public DateTime? LastActivityDate { get; set; }

    public int TotalXp { get; set; } = 0;
}