using System.Net;
using System.Net.Mail;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;

namespace EnglishLearningPlatform.API.Services;

public record EmailResult(bool Delivered, string Transport, string? Error);

/// <summary>
/// Отправка писем. Если SMTP не настроен (локальная разработка),
/// письмо не уходит, а складывается в журнал EmailMessages — его видно
/// через /api/notifications/outbox.
/// </summary>
public class EmailSender
{
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly ILogger<EmailSender> _logger;

    public EmailSender(
        ApplicationDbContext context,
        IConfiguration configuration,
        ILogger<EmailSender> logger)
    {
        _context = context;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<EmailResult> SendAsync(
        string? userId,
        string to,
        string subject,
        string body,
        string kind,
        CancellationToken cancellationToken = default)
    {
        var message = new EmailMessage
        {
            UserId = userId,
            To = to,
            Subject = subject,
            Body = body,
            Kind = kind
        };

        var host = _configuration["Email:Smtp:Host"];

        if (string.IsNullOrWhiteSpace(to) || string.IsNullOrWhiteSpace(host))
        {
            message.Transport = "log";
            message.Delivered = false;
            message.Error = string.IsNullOrWhiteSpace(to)
                ? "У пользователя не указан email"
                : "SMTP не настроен — письмо сохранено в журнал";

            await SaveAsync(message, cancellationToken);

            _logger.LogInformation(
                "Email (журнал, SMTP не настроен) → {To}: {Subject}",
                message.To,
                message.Subject);

            return new EmailResult(false, "log", message.Error);
        }

        try
        {
            var port = _configuration.GetValue("Email:Smtp:Port", 587);
            var user = _configuration["Email:Smtp:User"];
            var password = _configuration["Email:Smtp:Password"];
            var enableSsl = _configuration.GetValue("Email:Smtp:EnableSsl", true);
            var from = _configuration["Email:From"] ?? "no-reply@lexicon.local";
            var fromName = _configuration["Email:FromName"] ?? "Lexicon";

            using var client = new SmtpClient(host, port)
            {
                EnableSsl = enableSsl
            };

            if (!string.IsNullOrWhiteSpace(user))
            {
                client.Credentials = new NetworkCredential(user, password);
            }

            using var mail = new MailMessage
            {
                From = new MailAddress(from, fromName),
                Subject = subject,
                Body = body,
                IsBodyHtml = false
            };
            mail.To.Add(to);

            await client.SendMailAsync(mail, cancellationToken);

            message.Transport = "smtp";
            message.Delivered = true;
            message.SentAt = DateTime.UtcNow;

            await SaveAsync(message, cancellationToken);

            _logger.LogInformation("Email отправлен → {To}: {Subject}", to, subject);

            return new EmailResult(true, "smtp", null);
        }
        catch (Exception ex)
        {
            message.Transport = "smtp";
            message.Delivered = false;
            message.Error = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;

            await SaveAsync(message, cancellationToken);

            _logger.LogWarning(ex, "Не удалось отправить письмо на {To}", to);

            return new EmailResult(false, "smtp", message.Error);
        }
    }

    private async Task SaveAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        _context.EmailMessages.Add(message);

        try
        {
            await _context.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            // Журнал не должен ломать отправку
            _logger.LogError(ex, "Не удалось сохранить письмо в журнал");
        }
    }
}
