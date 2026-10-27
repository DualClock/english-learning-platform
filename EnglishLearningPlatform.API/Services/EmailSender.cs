using System.Net;
using System.Net.Mail;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;

namespace EnglishLearningPlatform.API.Services;

public record EmailResult(bool Delivered, string Transport, string? Error);

/// <summary>
/// Отправка писем. Транспорт выбирает <see cref="ResolveTransport"/>: HTTP-API Brevo
/// (`Email:Provider=brevo` + ключ), обычный SMTP или — когда ни то ни другое не
/// настроено — только журнал EmailMessages (его видно через /api/notifications/outbox).
/// SMTP-порты на VPS бывают закрыты хостером, поэтому API по 443 — рабочий запасной путь.
/// </summary>
public class EmailSender
{
    public const string BrevoClientName = "brevo";
    private const string BrevoSendUrl = "https://api.brevo.com/v3/smtp/email";

    // Статический клиент переиспользует соединения; создаётся один на процесс,
    // таймаут задаётся на запрос (см. Email:Brevo:TimeoutSeconds).
    private static readonly HttpClient SharedBrevoClient = new();

    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly ILogger<EmailSender> _logger;
    private readonly IHttpClientFactory? _httpClientFactory;

    public EmailSender(
        ApplicationDbContext context,
        IConfiguration configuration,
        ILogger<EmailSender> logger,
        IHttpClientFactory? httpClientFactory = null)
    {
        _context = context;
        _configuration = configuration;
        _logger = logger;
        _httpClientFactory = httpClientFactory;
    }

    /// <summary>
    /// Единственное место, где решается, куда письмо пойдёт на самом деле.
    /// "brevo" — HTTP-API; "smtp" — обычный SMTP; "log" — только в журнал.
    /// Ключ Brevo имеет приоритет: если он задан, закрытые хостером порты не важны.
    /// </summary>
    public static string ResolveTransport(
        string? provider,
        string? brevoApiKey,
        string? smtpHost,
        string? smtpUser,
        string? smtpPassword)
    {
        var wantsBrevo = string.Equals(provider?.Trim(), "brevo", StringComparison.OrdinalIgnoreCase);
        if (wantsBrevo && !string.IsNullOrWhiteSpace(brevoApiKey))
        {
            return "brevo";
        }

        var hostMissing = string.IsNullOrWhiteSpace(smtpHost);
        // Пароль не задан, а логин задан: соединение всё равно не авторизуется и будет
        // висеть до таймаута — не идём в него даже при включённом SMTP.
        var credentialsMissing = !string.IsNullOrWhiteSpace(smtpUser) && string.IsNullOrWhiteSpace(smtpPassword);

        return hostMissing || credentialsMissing ? "log" : "smtp";
    }

    /// <summary>Причина ухода в журнал — для `EmailMessages.Error` и предупреждения на старте.</summary>
    public static string ExplainLogOnly(
        string? provider,
        string? brevoApiKey,
        string? smtpHost,
        string? smtpUser,
        string? smtpPassword)
    {
        if (string.Equals(provider?.Trim(), "brevo", StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrWhiteSpace(brevoApiKey))
        {
            return "Email:Provider=brevo, но Email:Brevo:ApiKey пуст — письма будут только в журнале";
        }

        if (string.IsNullOrWhiteSpace(smtpHost))
        {
            return "SMTP не настроен — письмо сохранено в журнал";
        }

        return "SMTP: не задан пароль — письмо сохранено в журнал";
    }

    internal sealed record BrevoSender(
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("email")] string Email);

    internal sealed record BrevoRecipient(
        [property: JsonPropertyName("email")] string Email,
        [property: JsonPropertyName("name")] string? Name);

    internal sealed record BrevoSendRequest(
        [property: JsonPropertyName("sender")] BrevoSender Sender,
        [property: JsonPropertyName("to")] BrevoRecipient[] To,
        [property: JsonPropertyName("subject")] string Subject,
        [property: JsonPropertyName("textContent")] string TextContent);

    /// <summary>
    /// Тело запроса Brevo `POST /v3/smtp/email`. Вынесено из сетевого кода, чтобы
    /// форму payload можно было проверить тестом без обращения к провайдеру.
    /// </summary>
    public static string BuildBrevoPayload(string from, string? fromName, string to, string subject, string body)
    {
        var request = new BrevoSendRequest(
            new BrevoSender(string.IsNullOrWhiteSpace(fromName) ? null : fromName, from),
            new[] { new BrevoRecipient(to, null) },
            subject,
            body);

        return JsonSerializer.Serialize(request);
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
        var user = _configuration["Email:Smtp:User"];
        var password = _configuration["Email:Smtp:Password"];
        var provider = _configuration["Email:Provider"];
        var brevoKey = _configuration["Email:Brevo:ApiKey"];

        var transport = ResolveTransport(provider, brevoKey, host, user, password);

        if (string.IsNullOrWhiteSpace(to) || transport == "log")
        {
            message.Transport = "log";
            message.Delivered = false;
            message.Error = string.IsNullOrWhiteSpace(to)
                ? "У пользователя не указан email"
                : ExplainLogOnly(provider, brevoKey, host, user, password);

            await SaveAsync(message, cancellationToken);

            _logger.LogInformation(
                "Email (журнал, транспорт не выбран) → {To}: {Subject}",
                message.To,
                message.Subject);

            return new EmailResult(false, "log", message.Error);
        }

        if (transport == "brevo")
        {
            return await SendViaBrevoAsync(message, brevoKey!, cancellationToken);
        }

        try
        {
            var port = _configuration.GetValue("Email:Smtp:Port", 587);
            var enableSsl = _configuration.GetValue("Email:Smtp:EnableSsl", true);
            var from = _configuration["Email:From"] ?? "no-reply@lexicon.local";
            var fromName = _configuration["Email:FromName"] ?? "Lexicon";

            using var client = new SmtpClient(host, port)
            {
                EnableSsl = enableSsl,
                // Без таймаута недоступный SMTP держит HTTP-запрос до 100 секунд
                Timeout = _configuration.GetValue("Email:Smtp:TimeoutMs", 10000)
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

    /// <summary>
    /// Отправка через HTTP-API Brevo: `POST https://api.brevo.com/v3/smtp/email`,
    /// ключ в заголовке `api-key`. Выбран вместо SMTP потому, что хостер держит
    /// исходящие 25/465/587 закрытыми, а 443 с сервера достижим.
    /// </summary>
    private async Task<EmailResult> SendViaBrevoAsync(
        EmailMessage message,
        string apiKey,
        CancellationToken cancellationToken)
    {
        var from = _configuration["Email:From"];
        var fromName = _configuration["Email:FromName"] ?? "Lexicon";

        // Brevo принимает отправителя только из подтверждённого списка, а без адреса
        // и спрашивать нечего — отказываем сразу, не дёргая провайдера.
        if (string.IsNullOrWhiteSpace(from) || !MailAddress.TryCreate(from, out _))
        {
            return await FailBrevoAsync(message, "Email:From не задан или не является адресом", cancellationToken);
        }

        var timeoutSeconds = Math.Clamp(_configuration.GetValue("Email:Brevo:TimeoutSeconds", 10), 2, 60);
        var client = _httpClientFactory?.CreateClient(BrevoClientName) ?? SharedBrevoClient;

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, BrevoSendUrl)
            {
                Content = new StringContent(
                    BuildBrevoPayload(from, fromName, message.To, message.Subject, message.Body),
                    Encoding.UTF8,
                    "application/json")
            };
            request.Headers.TryAddWithoutValidation("api-key", apiKey);

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));

            using var response = await client.SendAsync(request, timeout.Token);
            var responseBody = await SafeReadAsync(response, timeout.Token);

            if (response.IsSuccessStatusCode)
            {
                message.Transport = "brevo";
                message.Delivered = true;
                message.SentAt = DateTime.UtcNow;
                message.Error = null;

                await SaveAsync(message, cancellationToken);

                _logger.LogInformation("Email отправлен через Brevo → {To}: {Subject}", message.To, message.Subject);

                return new EmailResult(true, "brevo", null);
            }

            return await FailBrevoAsync(
                message,
                $"Brevo HTTP {(int)response.StatusCode}: {Cut(Sanitize(responseBody), 300)}",
                cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return await FailBrevoAsync(message, $"Brevo: нет ответа за {timeoutSeconds} с", cancellationToken);
        }
        catch (Exception ex)
        {
            return await FailBrevoAsync(message, "Brevo: " + Cut(Sanitize(ex.Message), 300), cancellationToken);
        }
    }

    private async Task<EmailResult> FailBrevoAsync(
        EmailMessage message,
        string error,
        CancellationToken cancellationToken)
    {
        message.Transport = "brevo";
        message.Delivered = false;
        message.Error = Cut(error, 500);

        await SaveAsync(message, cancellationToken);

        _logger.LogWarning("Письмо на {To} не ушло через Brevo: {Error}", message.To, message.Error);

        return new EmailResult(false, "brevo", message.Error);
    }

    // Ответ провайдера может быть большим HTML-стектрейсом; читаем только то, что
    // помещается, и не даём отмене по таймауту оборвать уже начатое чтение.
    private static async Task<string> SafeReadAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            return await response.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    private static string Sanitize(string? value) =>
        string.IsNullOrEmpty(value)
            ? string.Empty
            : value.Replace('\r', ' ').Replace('\n', ' ').Trim();

    private static string Cut(string value, int max) => value.Length <= max ? value : value[..max];

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
