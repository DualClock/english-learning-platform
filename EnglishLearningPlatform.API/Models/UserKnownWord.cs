using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Слово, которое пользователь отметил как уже известное.
/// Нужно читалке: по нему считается доля знакомых слов на странице.
/// </summary>
public class UserKnownWord
{
    public int Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    [MaxLength(100)]
    public string Text { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User? User { get; set; }
}
