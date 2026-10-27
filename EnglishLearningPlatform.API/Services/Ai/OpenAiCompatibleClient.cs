using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace EnglishLearningPlatform.API.Services.Ai;

/// <summary>
/// Клиент OpenAI-совместимого chat-completions API.
///
/// Зачем отдельный класс, а не «превратить наш запрос в Gemini-конверт и
/// отправить в чужое API»: существующий fallback (Pollinations) так и делает,
/// но это путь на каждый вызов — разбор и пересборка JSON. Здесь запрос
/// собирается в том виде, который провайдер ждёт, сразу.
///
/// Подходит любому провайдеру с протоколом OpenAI: DeepSeek, OpenRouter, Groq,
/// Mistral, локальный Ollama. Отличие только в BaseUrl и Model.
/// </summary>
public sealed class OpenAiCompatibleClient
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<OpenAiCompatibleClient> _logger;

    private static readonly HttpClient Http = new()
    {
        // Таймаут задаётся на каждый запрос через CancellationToken: общий на
        // клиенте не подходит, потому что генерация статьи и перевод слова
        // требуют разного времени.
        Timeout = Timeout.InfiniteTimeSpan,
    };

    public OpenAiCompatibleClient(IConfiguration configuration, ILogger<OpenAiCompatibleClient> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>Настроен ли провайдер: есть BaseUrl, ключ и модель.</summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(BaseUrl)
        && !string.IsNullOrWhiteSpace(ApiKey)
        && !string.IsNullOrWhiteSpace(Model);

    private string BaseUrl => _configuration["AiChat:BaseUrl"]?.Trim().TrimEnd('/') ?? string.Empty;

    private string ApiKey => _configuration["AiChat:ApiKey"]?.Trim() ?? string.Empty;

    private string Model => _configuration["AiChat:Model"]?.Trim() ?? string.Empty;

    private int TimeoutSeconds =>
        Math.Clamp(_configuration.GetValue("AiChat:TimeoutSeconds", 90), 5, 300);

    /// <summary>
    /// Один запрос к модели. Возвращает текст ответа или null — вызывающий код
    /// решает, что показать человеку, а транспортные ошибки не превращаются в
    /// исключения на весь запрос.
    /// </summary>
    public async Task<OpenAiChatResult?> CompleteAsync(
        string systemPrompt,
        string userPrompt,
        int maxOutputTokens,
        double temperature,
        CancellationToken ct)
    {
        if (!IsConfigured) return null;

        var payload = new
        {
            model = Model,
            messages = new[]
            {
                new { role = "system", content = systemPrompt },
                new { role = "user", content = userPrompt },
            },
            max_tokens = maxOutputTokens,
            temperature,
        };

        var body = JsonSerializer.Serialize(payload);

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/chat/completions")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ApiKey);

        // Свой токен на попытку: HttpClient.Timeout не используется, а токен
        // вызывающего надо уважать (он может отменить запрос раньше).
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(TimeoutSeconds));

        try
        {
            using var response = await Http.SendAsync(request, timeoutCts.Token);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(timeoutCts.Token);

                // 401/403 — ключ не тот или кончился, 404 — модель названа
                // неверно. Это разные причины, и в журнале они должны читаться
                // по-разному: иначе «сломался AI» ищут там, где надо поменять
                // название модели.
                _logger.LogWarning(
                    "OpenAI-совместимый провайдер ответил {Status} для модели {Model}: {Body}",
                    (int)response.StatusCode, Model, Truncate(errorBody, 500));

                return null;
            }

            using var stream = await response.Content.ReadAsStreamAsync(timeoutCts.Token);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: timeoutCts.Token);

            return Parse(doc.RootElement);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            _logger.LogWarning("Провайдер не ответил за {Timeout} с (модель {Model})", TimeoutSeconds, Model);
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ошибка запроса к OpenAI-совместимому провайдеру");
            return null;
        }
    }

    /// <summary>
    /// Разбор ответа. Пустой `content` — не ошибка транспорта, а нормальный
    /// ответ модели (например, всё ушло в reasoning-токены), поэтому
    /// возвращаем null с записью в журнал, а не исключение.
    /// </summary>
    private OpenAiChatResult? Parse(JsonElement root)
    {
        if (!root.TryGetProperty("choices", out var choices)
            || choices.ValueKind != JsonValueKind.Array
            || choices.GetArrayLength() == 0)
        {
            _logger.LogWarning("Ответ провайдера без choices");
            return null;
        }

        var first = choices[0];
        if (!first.TryGetProperty("message", out var message)
            || !message.TryGetProperty("content", out var content)
            || content.ValueKind != JsonValueKind.String)
        {
            _logger.LogWarning("Ответ провайдера без message.content");
            return null;
        }

        var text = content.GetString();
        if (string.IsNullOrWhiteSpace(text))
        {
            _logger.LogWarning("Провайдер вернул пустой текст");
            return null;
        }

        var model = root.TryGetProperty("model", out var m) && m.ValueKind == JsonValueKind.String
            ? m.GetString() ?? Model
            : Model;

        var promptTokens = 0;
        var completionTokens = 0;
        if (root.TryGetProperty("usage", out var usage))
        {
            if (usage.TryGetProperty("prompt_tokens", out var pt) && pt.TryGetInt32(out var ptv)) promptTokens = ptv;
            if (usage.TryGetProperty("completion_tokens", out var ctk) && ctk.TryGetInt32(out var ctv)) completionTokens = ctv;
        }

        return new OpenAiChatResult(text.Trim(), model!, promptTokens, completionTokens);
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max];
}

/// <summary>Текст ответа и расход токенов — для журнала квоты.</summary>
public sealed record OpenAiChatResult(
    string Text,
    string Model,
    int PromptTokens,
    int CompletionTokens);
