using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Журнал исходящих писем. Нужен, чтобы:
///  - не отправлять одно и то же напоминание дважды в день;
///  - видеть, что было отправлено, даже если SMTP не настроен (dev-режим);
///  - позже сделать админку/повторную отправку.
/// </summary>
public class EmailMessage
{
    public int Id { get; set; }

    public string? UserId { get; set; }

    [MaxLength(320)]
    public string To { get; set; } = string.Empty;

    [MaxLength(200)]
    public string Subject { get; set; } = string.Empty;

    public string Body { get; set; } = string.Empty;

    /// <summary>reminder | weekly | test</summary>
    [MaxLength(20)]
    public string Kind { get; set; } = "reminder";

    /// <summary>smtp | log</summary>
    [MaxLength(10)]
    public string Transport { get; set; } = "log";

    public bool Delivered { get; set; }

    [MaxLength(500)]
    public string? Error { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? SentAt { get; set; }
}
