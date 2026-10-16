using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class Word
{
    public int Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string Text { get; set; } = string.Empty;

    [MaxLength(50)]
    public string? Language { get; set; } = "en"; // en, ru, etc.

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Навигационные свойства
    public ICollection<WordDefinition> Definitions { get; set; } = new List<WordDefinition>();
    public ICollection<UserWord> UserWords { get; set; } = new List<UserWord>();
}