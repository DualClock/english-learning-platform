using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Мгновенное уведомление о новом отзыве через ntfy.sh.
/// Нужен только секретный topic: без аккаунта и пароля. Это рабочий канал
/// на серверах, где провайдер закрывает исходящий SMTP.
/// </summary>
public class FeedbackNotifier
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;
    private readonly ILogger<FeedbackNotifier> _logger;

    public FeedbackNotifier(
        HttpClient httpClient,
        IConfiguration configuration,
        ILogger<FeedbackNotifier> logger)
    {
        _httpClient = httpClient;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task NotifyAsync(
        string typeLabel,
        string message,
        string? contact,
        string? pagePath,
        string? userEmail,
        CancellationToken cancellationToken)
    {
        var topic = _configuration["Feedback:NtfyTopic"];
        if (string.IsNullOrWhiteSpace(topic))
        {
            return;
        }

        var server = _configuration["Feedback:NtfyServer"];
        if (string.IsNullOrWhiteSpace(server))
        {
            server = "https://ntfy.sh";
        }

        var body =
            $"[{typeLabel}] {(string.IsNullOrWhiteSpace(pagePath) ? "/" : pagePath)}{Environment.NewLine}" +
            $"Контакт: {(string.IsNullOrWhiteSpace(contact) ? "не оставлен" : contact)}{Environment.NewLine}" +
            $"Пользователь: {(string.IsNullOrWhiteSpace(userEmail) ? "аноним" : userEmail)}{Environment.NewLine}{Environment.NewLine}" +
            (message.Length > 1200 ? message[..1200] + "…" : message);

        var url = $"{server.TrimEnd('/')}/{Uri.EscapeDataString(topic.Trim())}";

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(body, Encoding.UTF8, "text/plain")
        };
        request.Headers.TryAddWithoutValidation("Title", "Lexicon feedback");
        request.Headers.TryAddWithoutValidation("Tags", typeLabel == "Проблема" ? "warning" : "bulb");
        request.Headers.TryAddWithoutValidation("Priority", typeLabel == "Проблема" ? "high" : "default");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(6));

        try
        {
            using var response = await _httpClient.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("ntfy вернул {StatusCode}", (int)response.StatusCode);
            }
        }
        catch (Exception ex)
        {
            // Уведомление не должно ломать приём отзыва: копия уже в EmailMessages
            _logger.LogWarning(ex, "Не удалось отправить уведомление в ntfy");
        }
    }
}
