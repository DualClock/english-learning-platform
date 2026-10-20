using EnglishLearningPlatform.API.Models;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Письма, связанные с аккаунтом: сброс пароля и подтверждение email.
///
/// Раньше токен сброса отдавался прямо в ответе /api/auth/forgot-password,
/// поэтому сброс работал только в Development. Теперь токен уходит письмом,
/// а в ответе его нет — остаётся только нейтральное «письмо отправлено».
/// Ссылка ведёт на фронтенд, токен подставляет форма.
/// </summary>
public class AuthEmailService
{
    private readonly EmailSender _email;
    private readonly IConfiguration _configuration;

    public AuthEmailService(EmailSender email, IConfiguration configuration)
    {
        _email = email;
        _configuration = configuration;
    }

    private string FrontendUrl =>
        (_configuration["App:FrontendUrl"] ?? "http://localhost:3000").TrimEnd('/');

    /// <summary>Письмо «сбросить пароль» со ссылкой на форму нового пароля.</summary>
    public Task<EmailResult> SendPasswordResetAsync(
        User user,
        string token,
        CancellationToken cancellationToken = default)
    {
        var email = user.Email ?? string.Empty;
        var link = $"{FrontendUrl}/reset-password?email={Uri.EscapeDataString(email)}&token={Uri.EscapeDataString(token)}";

        var body = string.Join(Environment.NewLine, new[]
        {
            $"Привет, {Name(user)}!",
            "",
            "Ты запросил восстановление пароля в Lexicon.",
            "Открой ссылку и придумай новый пароль:",
            "",
            link,
            "",
            "Ссылка действует 24 часа. Если это был не ты — просто проигнорируй письмо,",
            "пароль останется прежним.",
            "",
            "— Lexicon"
        });

        return _email.SendAsync(
            user.Id,
            email,
            "Восстановление пароля — Lexicon",
            body,
            "password-reset",
            cancellationToken);
    }

    /// <summary>Письмо «подтверди email» со ссылкой-подтверждением.</summary>
    public Task<EmailResult> SendEmailConfirmationAsync(
        User user,
        string token,
        CancellationToken cancellationToken = default)
    {
        var email = user.Email ?? string.Empty;
        var link = $"{FrontendUrl}/confirm-email?email={Uri.EscapeDataString(email)}&token={Uri.EscapeDataString(token)}";

        var body = string.Join(Environment.NewLine, new[]
        {
            $"Привет, {Name(user)}!",
            "",
            "Подтверди email — так мы сможем присылать напоминания о повторении",
            "и восстановить пароль, если он забудется.",
            "",
            link,
            "",
            "Если ты не регистрировался в Lexicon — просто проигнорируй письмо.",
            "",
            "— Lexicon"
        });

        return _email.SendAsync(
            user.Id,
            email,
            "Подтверждение email — Lexicon",
            body,
            "confirm-email",
            cancellationToken);
    }

    private static string Name(User user) =>
        string.IsNullOrWhiteSpace(user.DisplayName)
            ? (user.Email ?? "друг").Split('@')[0]
            : user.DisplayName!;
}
