using System.Net;
using System.Text;
using System.Text.Json;

namespace EnglishLearningPlatform.API.Services;

// Контролируемая ошибка вызова ИИ. Message — безопасный русский текст
// для пользователя, без технических деталей (они только в логах).
public class AiUnavailableException : Exception
{
    public AiUnavailableException(string message) : base(message) { }
}

public record GeminiCallResult(string? Json, bool ModelNotFound);

// Единый слой вызовов Gemini: таймаут из конфига ("Ai:TimeoutSeconds"),
// retry с экспоненциальной задержкой (429, 5xx, сеть, таймаут, пустой/битый ответ),
// опциональный fallback-провайдер ("Ai:FallbackApiKey"/"Ai:FallbackModel").
// В лог пишем только тип запроса, userId и текст ошибки — без текстов запросов.
public class ResilientAiService
{
    public const string UserErrorMessage =
        "Функция временно недоступна. Попробуйте ещё раз через пару минут.";

    private static readonly TimeSpan[] DefaultRetryDelays =
    {
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(4)
    };

    private readonly IConfiguration _configuration;
    private readonly ILogger<ResilientAiService> _logger;
    private readonly HttpClient? _httpClient;
    private readonly TimeSpan[] _retryDelays;

    private readonly object _clientLock = new();
    private HttpClient? _defaultClient;
    private HttpClient? _directClient;

    public ResilientAiService(
        IConfiguration configuration,
        ILogger<ResilientAiService> logger,
        HttpClient? httpClient = null,
        TimeSpan[]? retryDelays = null)
    {
        _configuration = configuration;
        _logger = logger;
        _httpClient = httpClient;
        _retryDelays = retryDelays ?? DefaultRetryDelays;
    }

    // Отправляет запрос в Gemini с ретраями. При 404 ("model not found") ретраи
    // бессмысленны — возвращаем ModelNotFound, чтобы вызывающий код перебрал модели.
    // После исчерпания попыток и fallback-провайдера бросает AiUnavailableException.
    public async Task<GeminiCallResult> SendAsync(
        string model,
        object requestBody,
        string apiKey,
        string requestType,
        string? userId = null,
        CancellationToken cancellationToken = default)
    {
        var maxAttempts = Math.Max(1, _configuration.GetValue("Ai:MaxRetries", 3));
        var timeoutSeconds = Math.Max(1, _configuration.GetValue("Ai:TimeoutSeconds", 20));

        string? lastError = null;

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            var outcome = await TrySendAsync(model, requestBody, apiKey, timeoutSeconds, cancellationToken);

            if (outcome.Result != null)
            {
                return outcome.Result;
            }

            if (outcome.ModelNotFound)
            {
                return new GeminiCallResult(null, true);
            }

            lastError = outcome.Error ?? "unknown error";

            if (!outcome.Retriable || attempt == maxAttempts)
            {
                break;
            }

            _logger.LogWarning(
                "Gemini call failed (requestType={RequestType}, userId={UserId}, attempt={Attempt}/{MaxAttempts}): {Error}",
                requestType, userId ?? "-", attempt, maxAttempts, lastError);

            var delay = GetDelay(attempt);
            if (delay > TimeSpan.Zero)
            {
                await Task.Delay(delay, cancellationToken);
            }
        }

        _logger.LogError(
            "Gemini call failed after {MaxAttempts} attempts (requestType={RequestType}, userId={UserId}): {Error}",
            maxAttempts, requestType, userId ?? "-", lastError);

        var fallbackJson = await TryFallbackProviderAsync(
            requestBody, requestType, userId, timeoutSeconds, cancellationToken);
        if (fallbackJson != null)
        {
            return new GeminiCallResult(fallbackJson, false);
        }

        // Последний резерв: бесплатный OpenAI-совместимый endpoint без ключа
        // (нужен, когда Gemini недоступен из региона, а прокси не работает).
        // Ответ конвертируется в Gemini-конверт, чтобы вызывающий код не менялся.
        if (_configuration.GetValue("Ai:EnablePollinationsFallback", true))
        {
            for (var attempt = 1; attempt <= 2; attempt++)
            {
                var pollinationsJson = await TryPollinationsAsync(
                    requestBody, requestType, userId, timeoutSeconds, cancellationToken);
                if (pollinationsJson != null)
                {
                    return new GeminiCallResult(pollinationsJson, false);
                }
            }
        }

        throw new AiUnavailableException(UserErrorMessage);
    }

    private sealed record AttemptOutcome(
        GeminiCallResult? Result,
        bool Retriable,
        bool ModelNotFound,
        string? Error);

    private async Task<AttemptOutcome> TrySendAsync(
        string model,
        object requestBody,
        string apiKey,
        int timeoutSeconds,
        CancellationToken cancellationToken)
    {
        try
        {
            var json = JsonSerializer.Serialize(requestBody);
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}";

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));

            using var response = await GetHttpClient().PostAsync(url, content, timeoutCts.Token);
            var responseJson = await response.Content.ReadAsStringAsync(cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                if (!IsValidEnvelope(responseJson))
                {
                    return new AttemptOutcome(null, Retriable: true, ModelNotFound: false,
                        Error: "empty or malformed response body");
                }

                return new AttemptOutcome(new GeminiCallResult(responseJson, false), false, false, null);
            }

            var modelNotFound = response.StatusCode == HttpStatusCode.NotFound ||
                                responseJson.Contains("not found", StringComparison.OrdinalIgnoreCase);
            if (modelNotFound)
            {
                return new AttemptOutcome(null, false, true, $"model not found: {(int)response.StatusCode}");
            }

            var retriable = response.StatusCode == HttpStatusCode.TooManyRequests ||
                            (int)response.StatusCode >= 500;

            return new AttemptOutcome(null, retriable, false, $"HTTP {(int)response.StatusCode}");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new AttemptOutcome(null, true, false, "request timeout");
        }
        catch (HttpRequestException ex)
        {
            // Прокси упал/подписка истекла — пробуем напрямую без прокси
            var direct = await TrySendDirectAsync(model, requestBody, apiKey, timeoutSeconds, cancellationToken);
            if (direct != null)
            {
                return direct;
            }

            return new AttemptOutcome(null, true, false, ex.Message);
        }
    }

    // Отдельная попытка без прокси (используется как обход при падении прокси)
    private async Task<AttemptOutcome?> TrySendDirectAsync(
        string model,
        object requestBody,
        string apiKey,
        int timeoutSeconds,
        CancellationToken cancellationToken)
    {
        try
        {
            var json = JsonSerializer.Serialize(requestBody);
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}";

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));

            using var response = await GetDirectHttpClient().PostAsync(url, content, timeoutCts.Token);
            var responseJson = await response.Content.ReadAsStringAsync(cancellationToken);

            if (response.IsSuccessStatusCode && IsValidEnvelope(responseJson))
            {
                _logger.LogInformation("Gemini direct (no-proxy) call succeeded after proxy failure");
                return new AttemptOutcome(new GeminiCallResult(responseJson, false), false, false, null);
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    // Одна попытка через fallback-провайдер, если он настроен в конфиге
    private async Task<string?> TryFallbackProviderAsync(
        object requestBody,
        string requestType,
        string? userId,
        int timeoutSeconds,
        CancellationToken cancellationToken)
    {
        var fallbackKey = _configuration["Ai:FallbackApiKey"];
        var fallbackModel = _configuration["Ai:FallbackModel"];
        if (string.IsNullOrWhiteSpace(fallbackKey) || string.IsNullOrWhiteSpace(fallbackModel))
        {
            return null;
        }

        var outcome = await TrySendAsync(fallbackModel, requestBody, fallbackKey, timeoutSeconds, cancellationToken);
        if (outcome.Result?.Json != null)
        {
            _logger.LogInformation(
                "Gemini fallback provider succeeded (requestType={RequestType}, userId={UserId})",
                requestType, userId ?? "-");
            return outcome.Result.Json;
        }

        _logger.LogError(
            "Gemini fallback provider failed (requestType={RequestType}, userId={UserId}): {Error}",
            requestType, userId ?? "-", outcome.Error);
        return null;
    }

    // Fallback на text.pollinations.ai (OpenAI-совместимый, без ключа).
    // Из Gemini-тела извлекаем systemInstruction + contents -> messages,
    // ответ заворачиваем обратно в Gemini-конверт {candidates:[...]}.
    private async Task<string?> TryPollinationsAsync(
        object requestBody,
        string requestType,
        string? userId,
        int timeoutSeconds,
        CancellationToken cancellationToken)
    {
        try
        {
            using var doc = JsonDocument.Parse(JsonSerializer.Serialize(requestBody));
            var root = doc.RootElement;

            var messages = new List<object>();

            if (root.TryGetProperty("systemInstruction", out var sys) &&
                sys.ValueKind == JsonValueKind.Object &&
                sys.TryGetProperty("parts", out var sysParts))
            {
                var sysText = JoinParts(sysParts);
                if (!string.IsNullOrWhiteSpace(sysText))
                {
                    messages.Add(new { role = "system", content = sysText });
                }
            }

            if (root.TryGetProperty("contents", out var contents) &&
                contents.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in contents.EnumerateArray())
                {
                    if (!item.TryGetProperty("parts", out var parts))
                    {
                        continue;
                    }

                    var text = JoinParts(parts);
                    if (string.IsNullOrWhiteSpace(text))
                    {
                        continue;
                    }

                    var role = item.TryGetProperty("role", out var r) &&
                               r.GetString() == "model"
                        ? "assistant"
                        : "user";
                    messages.Add(new { role, content = text });
                }
            }

            if (messages.Count == 0)
            {
                return null;
            }

            var body = JsonSerializer.Serialize(new { model = "openai", messages });
            using var content = new StringContent(body, Encoding.UTF8, "application/json");

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(Math.Max(timeoutSeconds, 30)));

            using var response = await GetDirectHttpClient().PostAsync(
                "https://text.pollinations.ai/openai", content, timeoutCts.Token);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Pollinations fallback HTTP {Status} (requestType={RequestType})",
                    (int)response.StatusCode, requestType);
                return null;
            }

            var responseJson = await response.Content.ReadAsStringAsync(cancellationToken);
            using var respDoc = JsonDocument.Parse(responseJson);
            var answerText = respDoc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();
            if (string.IsNullOrWhiteSpace(answerText))
            {
                return null;
            }

            _logger.LogInformation(
                "Pollinations fallback succeeded (requestType={RequestType}, userId={UserId})",
                requestType, userId ?? "-");

            return JsonSerializer.Serialize(new
            {
                candidates = new[]
                {
                    new
                    {
                        content = new
                        {
                            parts = new[] { new { text = answerText } }
                        }
                    }
                }
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Pollinations fallback failed (requestType={RequestType})", requestType);
            return null;
        }
    }

    private static string JoinParts(JsonElement parts)
    {
        if (parts.ValueKind != JsonValueKind.Array)
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        foreach (var part in parts.EnumerateArray())
        {
            if (part.TryGetProperty("text", out var t))
            {
                builder.Append(t.GetString());
            }
        }

        return builder.ToString();
    }

    // Пустой ответ или ответ без массива candidates считаем ошибкой (ретраится)
    private static bool IsValidEnvelope(string? responseJson)
    {
        if (string.IsNullOrWhiteSpace(responseJson))
        {
            return false;
        }

        try
        {
            using var doc = JsonDocument.Parse(responseJson);
            return doc.RootElement.TryGetProperty("candidates", out var candidates) &&
                   candidates.ValueKind == JsonValueKind.Array &&
                   candidates.GetArrayLength() > 0;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private TimeSpan GetDelay(int attempt)
    {
        if (_retryDelays.Length == 0)
        {
            return TimeSpan.Zero;
        }

        return _retryDelays[Math.Min(attempt - 1, _retryDelays.Length - 1)];
    }

    private HttpClient GetHttpClient()
    {
        if (_httpClient != null)
        {
            return _httpClient;
        }

        if (_defaultClient != null)
        {
            return _defaultClient;
        }

        lock (_clientLock)
        {
            _defaultClient ??= CreateHttpClient();
        }

        return _defaultClient;
    }

    private HttpClient GetDirectHttpClient()
    {
        if (_directClient != null)
        {
            return _directClient;
        }

        lock (_clientLock)
        {
            _directClient ??= new HttpClient(new HttpClientHandler { UseProxy = false })
            {
                Timeout = Timeout.InfiniteTimeSpan
            };
        }

        return _directClient;
    }

    private HttpClient CreateHttpClient()
    {
        var proxyUrl = _configuration["Gemini:ProxyUrl"];
        var handler = new HttpClientHandler();

        if (!string.IsNullOrEmpty(proxyUrl))
        {
            var uri = new Uri(proxyUrl);
            var proxy = new WebProxy
            {
                Address = new Uri($"{uri.Scheme}://{uri.Host}:{uri.Port}"),
                BypassProxyOnLocal = false,
                UseDefaultCredentials = false,
                Credentials = new NetworkCredential(
                    uri.UserInfo.Split(':')[0],
                    uri.UserInfo.Split(':')[1]
                )
            };

            handler.Proxy = proxy;
            handler.UseProxy = true;
            handler.PreAuthenticate = true;
        }

        // Таймаут управляется per-attempt CancellationToken, а не HttpClient.Timeout
        return new HttpClient(handler)
        {
            Timeout = Timeout.InfiniteTimeSpan
        };
    }
}
