using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class Word : ISoftDeletable
{
    public int Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string Text { get; set; } = string.Empty;

    [MaxLength(50)]
    public string? Language { get; set; } = "en"; // en, ru, etc.

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Удаление из общего словаря: строка остаётся, потому что на неё смотрят
    // UserWords и ReviewLogs. Слово исчезает из выдачи и из новых добавлений,
    // но SRS-карточки пользователей не рушатся.
    public DateTime? DeletedAt { get; set; }

    public string? DeletedByUserId { get; set; }

    // Навигационные свойства
    public ICollection<WordDefinition> Definitions { get; set; } = new List<WordDefinition>();
    public ICollection<UserWord> UserWords { get; set; } = new List<UserWord>();
}