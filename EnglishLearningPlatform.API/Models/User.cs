using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.AspNetCore.Identity;

namespace EnglishLearningPlatform.API.Models;

public class User : IdentityUser
{
    public string? DisplayName { get; set; }

    [MaxLength(300)]
    public string? AvatarUrl { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastLoginAt { get; set; }

    // Профиль и геймификация
    [MaxLength(2)]
    public string? CefrLevel { get; set; }

    [MaxLength(200)]
    public string? StudyGoal { get; set; }

    public int DailyGoalMinutes { get; set; } = 10;

    // Сколько новых слов показывать в повторении за день
    public int DailyNewWords { get; set; } = 10;

    public int CurrentStreak { get; set; } = 0;

    public int LongestStreak { get; set; } = 0;

    [Column(TypeName = "date")]
    public DateTime? LastActivityDate { get; set; }

    public int TotalXp { get; set; } = 0;

    // Часовой пояс пользователя (IANA, например "Europe/Moscow").
    // Нужен, чтобы «день» для стрика и дневной цели считался по местному времени,
    // а не по UTC.
    [MaxLength(100)]
    public string? TimeZoneId { get; set; }

    // Согласие на напоминания и удобный час (0–23).
    public bool NotifyEnabled { get; set; }

    public int ReminderHour { get; set; } = 9;
}