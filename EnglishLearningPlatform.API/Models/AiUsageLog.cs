using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

// Одна логическая AI-операция пользователя (translate, assistant_chat, ...).
// Пишется ResilientAiService'ом на каждый вызов SendAsync — используется
// для квот и учёта токенов.
public class AiUsageLog
{
    public long Id { get; set; }

    [Required]
    [MaxLength(64)]
    public string UserId { get; set; } = string.Empty;

    [MaxLength(50)]
    public string RequestType { get; set; } = "ai";

    [MaxLength(80)]
    public string Model { get; set; } = string.Empty;

    public int PromptTokens { get; set; }

    public int CompletionTokens { get; set; }

    public int TotalTokens { get; set; }

    public bool Success { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
