using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class UserCategoryWordProgress
{
    public int Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    public int CategoryWordId { get; set; }

    [MaxLength(20)]
    public string Status { get; set; } = "learning"; // learning | learned

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Навигационные свойства
    public User User { get; set; } = null!;
    public CategoryWord CategoryWord { get; set; } = null!;
}
