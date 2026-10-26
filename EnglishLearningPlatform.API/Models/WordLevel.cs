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

    // Пример-предложение к слову (R11). Nullable: справочник на 4500 слов
    // приходит без примеров, а «пустая строка» и «примера ещё нет» для карточки
    // одно и то же состояние, поэтому отдельное значение не нужно.
    [MaxLength(500)]
    public string? Example { get; set; }

    [MaxLength(500)]
    public string? ExampleRu { get; set; }
}
