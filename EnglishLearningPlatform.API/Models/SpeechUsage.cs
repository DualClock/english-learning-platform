using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Расход символов Azure Speech за календарный месяц. Это защита от счёта,
/// а не оптимизация: бесплатный тариф кончается молча, и без счётчика один
/// читатель с автоперелистыванием может выжечь бюджет всей платформы.
/// </summary>
public class SpeechUsage
{
    /// <summary>Период в формате yyyy-MM (UTC). Первичный ключ.</summary>
    [Key]
    [MaxLength(7)]
    public string Period { get; set; } = string.Empty;

    public long Chars { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
