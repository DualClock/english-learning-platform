using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.AspNetCore.Identity;

namespace EnglishLearningPlatform.API.Models;

public class User : IdentityUser
{
    public string? DisplayName { get; set; }

    [MaxLength(300)]
    public string? AvatarUrl { get; set; }

    // Косметика профиля: рамка не меняет данные обучения, только внешний вид.
    [MaxLength(20)]
    public string AvatarFrame { get; set; } = "none";

    [MaxLength(20)]
    public string AccentTheme { get; set; } = "teal";

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

    // Лига текущей недели. Меняется только при закрытии недели, не от каждого XP.
    [MaxLength(20)]
    public string League { get; set; } = "bronze";

    // Часовой пояс пользователя (IANA, например "Europe/Moscow").
    // Нужен, чтобы «день» для стрика и дневной цели считался по местному времени,
    // а не по UTC.
    [MaxLength(100)]
    public string? TimeZoneId { get; set; }

    // Согласие на напоминания и удобный час (0–23).
    public bool NotifyEnabled { get; set; }

    public int ReminderHour { get; set; } = 9;

    // Атрибуция канала: откуда человек узнал о сервисе. Пишется один раз при
    // регистрации и больше не перезаписывается — иначе повторный вход с другой
    // ссылкой переписал бы историю, и через неделю нельзя было бы сказать,
    // какой канал дал читающих людей, а не просто регистрации.
    // Source — канал (utm_source или личный код, приоритет у кода),
    // Code — конкретная ссылка/пост (utm_content, когда кода нет).
    [MaxLength(64)]
    public string? AcquisitionSource { get; set; }

    [MaxLength(64)]
    public string? AcquisitionCode { get; set; }
}