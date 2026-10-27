using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class Category : ISoftDeletable
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

    // Удалённая категория пропадает из каталога, но её слова и прогресс
    // пользователей остаются: восстановление категории возвращает всё как было.
    public DateTime? DeletedAt { get; set; }

    public string? DeletedByUserId { get; set; }

    public ICollection<CategoryWord> Words { get; set; } = new List<CategoryWord>();
}

public class CategoryWord : ISoftDeletable
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

    // Картинка слова, загруженная админом. Относительный URL вида
    // /uploads/word-images/<guid>.webp — он переживает перезапуск и переезд
    // между окружениями, в отличие от абсолютного адреса с хостом.
    //
    // Хранится на CategoryWord, а не на общем Word: слово в разных категориях
    // может иметь разные картинки, а правка одной категории не должна менять
    // вид другой.
    [MaxLength(300)]
    public string? ImageUrl { get; set; }

    // Слово убирается из категории, а UserCategoryWordProgress («выучил») не
    // трогается. Раньше связь стояла на Cascade — удаление одного слова
    // стирало прогресс всех пользователей по нему.
    public DateTime? DeletedAt { get; set; }

    public string? DeletedByUserId { get; set; }

    // Навигационные свойства
    public Category Category { get; set; } = null!;
    public ICollection<UserCategoryWordProgress> UserProgresses { get; set; } = new List<UserCategoryWordProgress>();
}
