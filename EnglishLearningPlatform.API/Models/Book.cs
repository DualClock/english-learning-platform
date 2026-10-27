using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class Book : ISoftDeletable
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? Author { get; set; }

    [MaxLength(50)]
    public string Language { get; set; } = "en";

    [MaxLength(500)]
    public string? Description { get; set; }

    // Файл
    [MaxLength(500)]
    public string FilePath { get; set; } = string.Empty;

    public long FileSize { get; set; }

    // Обложка
    [MaxLength(500)]
    public string? CoverUrl { get; set; }

    // Прогресс чтения
    public int CurrentPage { get; set; } = 1;
    public int TotalPages { get; set; } = 1;
    public double Progress { get; set; } = 0;

    [MaxLength(2)]
    public string? CefrLevel { get; set; }

    public int WordCount { get; set; } = 0;

    // Структурный разбор читалки. Хэш позволяет переиспользовать один снимок
    // для всех пользовательских копий одной и той же книги.
    [MaxLength(64)]
    public string? ContentHash { get; set; }

    public int? ContentSnapshotId { get; set; }

    public DateTime? ParsedAt { get; set; }

    // Кто загрузил
    public string? UploadedByUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Удаление книги из каталога: EPUB на диске и строки BookKeyWords остаются
    // до отдельной уборки, а у пользователей сохраняются закладки и прогресс
    // (UserBookProgress ссылается на Book с Cascade — физический DELETE его бы
    // унёс, а читатель потерял бы место в книге).
    public DateTime? DeletedAt { get; set; }

    public string? DeletedByUserId { get; set; }

    // Навигационные свойства
    public ICollection<Interaction> Interactions { get; set; } = new List<Interaction>();
    public BookContentSnapshot? ContentSnapshot { get; set; }
}

public class Interaction
{
    public int Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    public int? BookId { get; set; }

    public int? WordId { get; set; }

    [MaxLength(500)]
    public string? ContextSentence { get; set; } // Предложение, где встретилось слово

    [MaxLength(50)]
    public string Source { get; set; } = "reader"; // reader, manual, quiz

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Навигационные свойства
    public Book? Book { get; set; }
    public Word? Word { get; set; }
    public User User { get; set; } = null!;
}