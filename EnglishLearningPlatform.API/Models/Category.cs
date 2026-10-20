using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class Category
{
    public int Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string Slug { get; set; } = string.Empty;

    [MaxLength(20)]
    public string? Icon { get; set; }

    [MaxLength(20)]
    public string? Color { get; set; }

    [MaxLength(500)]
    public string? Description { get; set; }

    public ICollection<CategoryWord> Words { get; set; } = new List<CategoryWord>();
}

public class CategoryWord
{
    public int Id { get; set; }

    public int CategoryId { get; set; }

    [Required]
    [MaxLength(100)]
    public string English { get; set; } = string.Empty;

    [Required]
    [MaxLength(200)]
    public string Translation { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? Transcription { get; set; }

    [MaxLength(500)]
    public string? Example { get; set; }

    // Навигационные свойства
    public Category Category { get; set; } = null!;
    public ICollection<UserCategoryWordProgress> UserProgresses { get; set; } = new List<UserCategoryWordProgress>();
}
