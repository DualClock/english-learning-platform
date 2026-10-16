using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class WordDefinition
{
    public int Id { get; set; }

    public int WordId { get; set; }

    [Required]
    [MaxLength(500)]
    public string Definition { get; set; } = string.Empty; // Перевод или определение

    [MaxLength(50)]
    public string? PartOfSpeech { get; set; } // noun, verb, adjective...

    [MaxLength(2000)]
    public string? Example { get; set; } // Пример использования

    public int DisplayOrder { get; set; } = 0; // Порядок отображения

    // Навигационное свойство
    public Word Word { get; set; } = null!;
}