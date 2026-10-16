using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class WordLevel
{
    [Key]
    [MaxLength(100)]
    public string Text { get; set; } = string.Empty;

    [MaxLength(2)]
    public string CefrLevel { get; set; } = string.Empty;

    [MaxLength(300)]
    public string? TranslationRu { get; set; }

    public int FreqRank { get; set; }
}
