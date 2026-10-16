using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class WordList
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(1000)]
    public string? Description { get; set; }

    [MaxLength(2)]
    public string? CefrFrom { get; set; }

    [MaxLength(2)]
    public string? CefrTo { get; set; }

    public int ItemCount { get; set; }

    // Навигационные свойства
    public ICollection<WordListItem> Items { get; set; } = new List<WordListItem>();
}

public class WordListItem
{
    public int Id { get; set; }

    public int ListId { get; set; }

    [Required]
    [MaxLength(100)]
    public string WordText { get; set; } = string.Empty;

    [MaxLength(2)]
    public string? CefrLevel { get; set; }

    public int FreqRank { get; set; }

    // Навигационное свойство
    public WordList List { get; set; } = null!;
}
