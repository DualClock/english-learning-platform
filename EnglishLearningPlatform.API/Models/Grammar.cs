using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class GrammarUnit
{
    public int Id { get; set; }

    public int Order { get; set; }

    [Required]
    [MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(2)]
    public string CefrLevel { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? Section { get; set; }

    [MaxLength(8000)]
    public string? TheoryHtml { get; set; }

    [MaxLength(300)]
    public string? ShortDescription { get; set; }

    // Навигационные свойства
    public ICollection<GrammarExercise> Exercises { get; set; } = new List<GrammarExercise>();
    public ICollection<UserGrammarProgress> UserProgresses { get; set; } = new List<UserGrammarProgress>();
}

public class GrammarExercise
{
    public int Id { get; set; }

    public int UnitId { get; set; }

    public int Order { get; set; }

    // "mc" | "fill"
    [Required]
    [MaxLength(10)]
    public string Type { get; set; } = string.Empty;

    [Required]
    [MaxLength(500)]
    public string Prompt { get; set; } = string.Empty;

    // JSON-массив строк, для mc
    [MaxLength(2000)]
    public string? OptionsJson { get; set; }

    [Required]
    [MaxLength(200)]
    public string CorrectAnswer { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Explanation { get; set; }

    // Навигационное свойство
    public GrammarUnit Unit { get; set; } = null!;
}

public class UserGrammarProgress
{
    public int Id { get; set; }

    [Required]
    public string UserId { get; set; } = string.Empty;

    public int UnitId { get; set; }

    // 0-100
    public int Score { get; set; }

    public DateTime CompletedAt { get; set; }

    // Навигационные свойства
    public User User { get; set; } = null!;
    public GrammarUnit Unit { get; set; } = null!;
}
