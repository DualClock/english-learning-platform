using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Неизменяемый разбор EPUB: главы, абзацы, предложения и картинки.
/// Хранится сжатым JSON и переиспользуется всеми копиями одной книги —
/// поэтому «Моби Дик» разбирается один раз, а не на каждого читателя.
/// </summary>
public class BookContentSnapshot
{
    public int Id { get; set; }

    /// <summary>SHA-256 исходного EPUB. Вместе с версией парсера — ключ снимка.</summary>
    [Required]
    [MaxLength(64)]
    public string ContentHash { get; set; } = string.Empty;

    public int ParserVersion { get; set; }

    /// <summary>Сжатый JSON структуры. В БД — bytea, наружу не отдаётся.</summary>
    [Required]
    public byte[] JsonGzip { get; set; } = Array.Empty<byte>();

    public int ChapterCount { get; set; }

    public int WordCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
