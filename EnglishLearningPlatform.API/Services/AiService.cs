using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

public class AiService : IAiBackedService
{
    // Резервные модели: 2.5/2.0-flash больше не выдаются новым проектам,
    // основная модель берётся из Gemini:Model
    private static readonly string[] FallbackModels =
    {
        "gemini-3.8-flash",
        "gemini-flash-latest",
        "gemini-3.5-flash"
    };

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(24);

    /*
     * Клиенты для бесплатных эндпоинтов Google.
     *
     * Раньше здесь стояло `UseProxy = false` с комментарием «эндпоинты доступны
     * напрямую». Проверено вживую: напрямую translate.googleapis.com отвечает
     * HTTP 429 с HTML «Sorry...» — Google блокирует наш адрес, а через прокси
     * (тот же Gemini:ProxyUrl) те же запросы идут с кодом 200. Из-за этого
     * перевод фразы в /listening и в карточке слова отдавал 503 «сервис
     * временно недоступен», хотя провайдер работал.
     *
     * Клиенты создаются лениво и ОДИН РАЗ НА ПРОЦЕСС. AiService зарегистрирован
     * как Scoped (Program.cs:226), поэтому экземплярные поля здесь означали бы
     * новый HttpClient на каждый HTTP-запрос: замерено — установка SOCKS5-
     * соединения стоит 1.4–2.2 с, и столько добавлялось к каждому переводу.
     * Статика нужна именно тут, несмотря на то что обычно клиентов так не держат.
     */
    /*
     * User-Agent для бесплатных эндпоинтов Google.
     *
     * Проверено тремя прогонами одного и того же запроса из процесса .NET:
     *   дефолтный UA .NET  через прокси → HTTP 429
     *   браузерный UA      через прокси → HTTP 200
     *   браузерный UA      без прокси   → HTTP 200
     * То есть Google отбивал не адрес и не отсутствие прокси, а строку
     * `User-Agent: .NET/…`. curl и python проходили напрямую именно потому,
     * что шлют обычный UA — из-за этого дефект и не был виден снаружи.
     *
     * Перевод фразы в /listening и в карточке слова отдавал 503 «сервис
     * временно недоступен» при полностью рабочем провайдере.
     */
    private const string GoogleUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    /*
     * Клиент для бесплатных эндпоинтов Google — НОВЫЙ НА КАЖДЫЙ ЗАПРОС.
     *
     * Это выглядит как ошибка (HttpClient принято переиспользовать), но
     * проверено четырьмя прогонами из процесса .NET:
     *
     *   новый клиент на запрос   → 429, 200, 200
     *   один клиент на все       → 429, 429, 429, 429, 429, 429
     *
     * Причина: HttpClientHandler держит ОДИН SOCKS5-туннель, и Google отбивает
     * все обращения внутри уже установленного туннеля как серию от одного
     * клиента. Свежий туннель на каждый запрос проходит. Поэтому здесь нет
     * кэширования, и `new HttpClientHandler` на каждый вызов — намеренно.
     *
     * Второй, независимый дефект из той же серии: `UseProxy = false` (как было
     * раньше) даёт 429 всегда — Google блокирует наш прямой адрес. Прокси
     * обязателен, и берётся из той же настройки Gemini:ProxyUrl.
     */
    private HttpClient CreateGoogleClient(TimeSpan timeout)
    {
        var proxyUrl = _configuration["Gemini:ProxyUrl"];
        var handler = new HttpClientHandler
        {
            // Соединение живёт один запрос: см. комментарий выше.
            AutomaticDecompression = System.Net.DecompressionMethods.All
        };

        var proxy = ProxyFactory.TryCreate(proxyUrl, _logger);
        if (proxy != null)
        {
            handler.Proxy = proxy;
            handler.UseProxy = true;
            handler.PreAuthenticate = true;
        }
        else
        {
            _logger.LogWarning(
                "Google translate: Gemini:ProxyUrl не задан — прямой запрос получит 429");
        }

        var client = new HttpClient(handler) { Timeout = timeout };
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", GoogleUserAgent);
        client.DefaultRequestHeaders.TryAddWithoutValidation("Accept-Language", "en-US,en;q=0.9,ru;q=0.8");
        client.DefaultRequestHeaders.ConnectionClose = true;
        return client;
    }

    /*
     * Клиенты не кэшируются — см. CreateGoogleClient: соединение на запрос.
     * Свойство оставлено ради читаемости вызовов ниже.
     */
    private HttpClient NewGoogleClient(TimeSpan timeout) => CreateGoogleClient(timeout);

    private static readonly TimeSpan FastTranslateCacheTtl = TimeSpan.FromHours(24);

    private static readonly TimeSpan TextTranslateCacheTtl = TimeSpan.FromHours(12);

    private static readonly TimeSpan LiteraryTranslateCacheTtl = TimeSpan.FromHours(24);

    private static string? _resolvedModel;

    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _cache;
    private readonly ILogger<AiService> _logger;
    private readonly ApplicationDbContext _context;
    private readonly ResilientAiService _resilient;

    public AiService(
        IConfiguration configuration,
        IMemoryCache cache,
        ILogger<AiService> logger,
        ApplicationDbContext context,
        ResilientAiService resilient)
    {
        _configuration = configuration;
        _cache = cache;
        _logger = logger;
        _context = context;
        _resilient = resilient;
    }

    public async Task<TranslationResult?> TranslateWordAsync(
        string word,
        string? context = null,
        string targetLanguage = "ru",
        string? userId = null)
    {
        var apiKey = _configuration["Gemini:ApiKey"];
        if (string.IsNullOrEmpty(apiKey))
        {
            _logger.LogError("Gemini API key is not configured");
            return null;
        }

        var cacheKey = BuildCacheKey(word, targetLanguage, context);
        if (_cache.TryGetValue(cacheKey, out TranslationResult? cached) && cached != null)
        {
            _logger.LogInformation("Translation cache hit for word: {Word}", word);
            return cached;
        }

        var prompt = BuildPrompt(word, context, targetLanguage, strict: false);
        var result = await TranslateWithPromptAsync(prompt, apiKey, word, userId);

        if (result == null)
        {
            _logger.LogInformation("Retrying translation for word {Word} with strict prompt", word);
            var strictPrompt = BuildPrompt(word, context, targetLanguage, strict: true);
            result = await TranslateWithPromptAsync(strictPrompt, apiKey, word, userId);
        }

        if (result != null)
        {
            _cache.Set(cacheKey, result, CacheTtl);
        }

        return result;
    }

    // Быстрый перевод слова без Gemini: сначала справочник WordLevels, потом
    // бесплатный Google Translate endpoint (напрямую, без прокси). Кэш 24ч.
    public async Task<TranslationResult?> FastTranslateAsync(string word)
    {
        var normalizedWord = word.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedWord))
        {
            return null;
        }

        var cacheKey = $"fasttranslate:ru:{normalizedWord}";
        if (_cache.TryGetValue(cacheKey, out TranslationResult? cached) && cached != null)
        {
            return cached;
        }

        // 1. Справочник уровней — мгновенно
        var level = await _context.WordLevels.AsNoTracking()
            .FirstOrDefaultAsync(wl => wl.Text == normalizedWord);

        if (!string.IsNullOrWhiteSpace(level?.TranslationRu))
        {
            var fromLevel = new TranslationResult
            {
                Translation = level.TranslationRu,
                Alternatives = new List<string>(),
                PartOfSpeech = null,
                Examples = new List<ExampleSentence>(),
                Source = "level_map"
            };
            _cache.Set(cacheKey, fromLevel, FastTranslateCacheTtl);
            return fromLevel;
        }

        // 2. Google Translate (gtx) как бесплатный fallback
        var result = await TranslateWithGoogleAsync(normalizedWord);
        if (result != null)
        {
            result.Source = "gtx";
            _cache.Set(cacheKey, result, FastTranslateCacheTtl);
        }

        return result;
    }

    // Перевод произвольного текста (предложение/абзац) en→ru через gtx.
    // Кэш 12ч, ключ — SHA256 текста. При любой ошибке возвращает null.
    public async Task<string?> TranslateTextAsync(string text)
    {
        var normalized = text.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return null;
        }

        var cacheKey = "translatetext:ru:" +
                       Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
        if (_cache.TryGetValue(cacheKey, out string? cached) && !string.IsNullOrEmpty(cached))
        {
            return cached;
        }

        var translation = await TranslateViaGtxAsync(normalized, NewGoogleClient(TimeSpan.FromSeconds(10)));
        if (translation != null)
        {
            _cache.Set(cacheKey, translation, TextTranslateCacheTtl);
        }

        return translation;
    }

    // Литературный перевод страницы en→ru через Gemini (с прокси и fallback-моделями),
    // при ошибке — fallback на gtx-перевод TranslateTextAsync. Кэш 24ч, ключ от SHA256 текста.
    public async Task<string?> TranslateLiteraryAsync(string text, string? userId = null)
    {
        var normalized = text.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return null;
        }

        var cacheKey = "translateliterary:ru:" +
                       Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
        if (_cache.TryGetValue(cacheKey, out string? cached) && !string.IsNullOrEmpty(cached))
        {
            return cached;
        }

        string? translation = null;

        var apiKey = _configuration["Gemini:ApiKey"];
        if (!string.IsNullOrEmpty(apiKey))
        {
            var prompt = "Translate this English literary text into natural, fluent Russian. " +
                         "Preserve the author's tone and style. Keep the same number of " +
                         "paragraphs/segments separated by double newlines. Return only the translation." +
                         $"\n\n{normalized}";

            string? responseJson = null;
            try
            {
                responseJson = await CallGeminiAsync(prompt, apiKey, temperature: 0.3, maxOutputTokens: 2048,
                    requestType: "translate_literary", userId: userId);
            }
            catch (AiUnavailableException ex)
            {
                // Ниже сработает gtx-fallback
                _logger.LogWarning(ex, "Literary translation via Gemini unavailable");
            }

            var raw = responseJson == null ? null : ExtractTextFromEnvelope(responseJson);

            if (!string.IsNullOrWhiteSpace(raw))
            {
                translation = StripMarkdownFences(raw!).Trim();
            }
        }
        else
        {
            _logger.LogError("Gemini API key is not configured");
        }

        if (translation == null)
        {
            _logger.LogInformation("Literary translation via Gemini failed, falling back to gtx");
            translation = await TranslateTextAsync(normalized);
        }

        if (translation != null)
        {
            _cache.Set(cacheKey, translation, LiteraryTranslateCacheTtl);
        }

        return translation;
    }

    // Общее ядро обращения к gtx: склеивает root[0][i][0] в один текст
    private async Task<string?> TranslateViaGtxAsync(string text, HttpClient httpClient)
    {
        try
        {
            var url = "https://translate.googleapis.com/translate_a/single" +
                      $"?client=gtx&sl=en&tl=ru&dt=t&q={Uri.EscapeDataString(text)}";

            /*
             * Повтор на 429 — с паузой.
             *
             * Замерено: первый запрос через свежее SOCKS5-соединение получает
             * TooManyRequests, следующий по тому же соединению — 200. Простой
             * немедленный повтор попадает в НОВОЕ соединение и снова ловит
             * «первый контакт», поэтому между попытками нужна пауза: за неё
             * пул соединений успевает переиспользовать уже открытый канал.
             *
             * Ровно две попытки: настоящий rate limit так не маскируется.
             */
            for (var attempt = 0; attempt < 2; attempt++)
            {
                if (attempt > 0)
                {
                    await Task.Delay(TimeSpan.FromMilliseconds(250));
                }

                using var response = await httpClient.GetAsync(url);
                if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests && attempt == 0)
                {
                    _logger.LogInformation(
                        "Google translate: 429 на первом обращении, повторяю (длина {Length})", text.Length);
                    continue;
                }

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Google translate returned {Status} for text of length {Length}",
                        response.StatusCode, text.Length);
                    return null;
                }

                var json = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                if (root.ValueKind != JsonValueKind.Array ||
                    root.GetArrayLength() == 0 ||
                    root[0].ValueKind != JsonValueKind.Array)
                {
                    return null;
                }

                var builder = new StringBuilder();
                foreach (var segment in root[0].EnumerateArray())
                {
                    if (segment.ValueKind == JsonValueKind.Array &&
                        segment.GetArrayLength() > 0 &&
                        segment[0].ValueKind == JsonValueKind.String)
                    {
                        builder.Append(segment[0].GetString());
                    }
                }

                var translation = builder.ToString().Trim();
                return string.IsNullOrWhiteSpace(translation) ? null : translation;
            }

            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Google translate failed for text of length {Length}", text.Length);
            return null;
        }
    }

    private async Task<TranslationResult?> TranslateWithGoogleAsync(string word)
    {
        var translation = await TranslateViaGtxAsync(word, NewGoogleClient(TimeSpan.FromSeconds(5)));
        if (translation == null)
        {
            return null;
        }

        return new TranslationResult
        {
            Translation = translation,
            Alternatives = new List<string>(),
            PartOfSpeech = null,
            Examples = new List<ExampleSentence>()
        };
    }

    public async Task<string?> GenerateJsonAsync(string prompt)
    {
        var apiKey = _configuration["Gemini:ApiKey"];
        if (string.IsNullOrEmpty(apiKey))
        {
            _logger.LogError("Gemini API key is not configured");
            return null;
        }

        var cacheKey = "genjson:" + Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(prompt.Trim())))[..32];
        if (_cache.TryGetValue(cacheKey, out string? cached) && !string.IsNullOrEmpty(cached))
        {
            return cached;
        }

        string? responseJson = null;
        try
        {
            responseJson = await CallGeminiAsync(prompt, apiKey, requestType: "generate_json");
        }
        catch (AiUnavailableException ex)
        {
            _logger.LogWarning(ex, "Gemini unavailable for generate_json");
            return null;
        }

        if (responseJson == null)
        {
            return null;
        }

        var text = ExtractTextFromEnvelope(responseJson);
        if (string.IsNullOrWhiteSpace(text))
        {
            _logger.LogWarning("Empty text in Gemini response for prompt hash {Hash}", cacheKey);
            return null;
        }

        text = StripMarkdownFences(text);
        _cache.Set(cacheKey, text, CacheTtl);
        return text;
    }

    private async Task<TranslationResult?> TranslateWithPromptAsync(string prompt, string apiKey, string word, string? userId)
    {
        var responseJson = await CallGeminiAsync(prompt, apiKey, requestType: "translate", userId: userId);
        if (responseJson == null)
        {
            return null;
        }

        var result = ParseGeminiResponse(responseJson);
        if (result == null)
        {
            _logger.LogWarning("Failed to parse Gemini response for word {Word}. Raw response: {Raw}",
                word, TruncateForLog(responseJson));
            return null;
        }

        result.Source = "ai";
        return result;
    }

    private static string BuildCacheKey(string word, string targetLanguage, string? context)
    {
        var normalizedWord = word.Trim().ToLowerInvariant();
        var lang = targetLanguage.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(context))
        {
            return $"translate:{lang}:{normalizedWord}";
        }

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(context.Trim())))[..16];
        return $"translate:{lang}:{normalizedWord}:{hash}";
    }

    private static string BuildPrompt(string word, string? context, string targetLanguage, bool strict)
    {
        var contextPart = string.IsNullOrWhiteSpace(context)
            ? ""
            : $" Context: \"{context}\".";

        var strictPart = strict
            ? " Respond with ONLY valid JSON, no markdown, no explanations."
            : "";

        return $"Translate the English word '{word}' to {targetLanguage}.{contextPart}" +
               " Reply with a single JSON object:" +
               " {\"translation\":\"main translation\",\"alternatives\":[\"alt1\",\"alt2\"]," +
               "\"partOfSpeech\":\"noun|verb|...\"," +
               "\"examples\":[{\"english\":\"sentence\",\"translation\":\"sentence\"},{\"english\":\"sentence\",\"translation\":\"sentence\"}]}." +
               strictPart;
    }

    private async Task<string?> CallGeminiAsync(
        string prompt,
        string apiKey,
        double temperature = 0.2,
        int maxOutputTokens = 2048,
        string requestType = "ai",
        string? userId = null)
    {
        var candidates = new List<string>();
        if (_resolvedModel != null)
        {
            candidates.Add(_resolvedModel);
        }

        var configuredModel = _configuration["Gemini:Model"];
        if (!string.IsNullOrWhiteSpace(configuredModel))
        {
            candidates.Add(configuredModel);
        }

        candidates.AddRange(FallbackModels);
        candidates = candidates.Distinct().ToList();

        var requestBody = new
        {
            contents = new[]
            {
                new
                {
                    parts = new[]
                    {
                        new { text = prompt }
                    }
                }
            },
            generationConfig = new
            {
                temperature,
                // Запас на thinking-токены у 2.5+/3.x моделей:
                // при 400 ответ обрезался посреди JSON и парсинг падал
                maxOutputTokens
            }
        };

        foreach (var model in candidates)
        {
            var (json, modelNotFound) = await _resilient.SendAsync(
                model, requestBody, apiKey, requestType, userId);
            if (json != null)
            {
                if (_resolvedModel != model)
                {
                    _resolvedModel = model;
                    _logger.LogInformation("Gemini model selected: {Model}", model);
                }

                return json;
            }

            if (!modelNotFound)
            {
                // Ошибка не связана с моделью (квота, 5xx и т.п.) — перебирать модели бессмысленно
                return null;
            }

            if (_resolvedModel == model)
            {
                _resolvedModel = null;
            }

            _logger.LogWarning("Gemini model {Model} not found, trying next fallback", model);
        }

        _logger.LogError("No working Gemini model found");
        return null;
    }

    private static string? ExtractTextFromEnvelope(string responseJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseJson);
            var root = doc.RootElement;

            if (!root.TryGetProperty("candidates", out var candidates) ||
                candidates.ValueKind != JsonValueKind.Array ||
                candidates.GetArrayLength() == 0)
            {
                return null;
            }

            var candidate = candidates[0];
            if (!candidate.TryGetProperty("content", out var contentEl) ||
                !contentEl.TryGetProperty("parts", out var parts) ||
                parts.ValueKind != JsonValueKind.Array ||
                parts.GetArrayLength() == 0 ||
                !parts[0].TryGetProperty("text", out var textEl))
            {
                return null;
            }

            return textEl.GetString();
        }
        catch
        {
            return null;
        }
    }

    private TranslationResult? ParseGeminiResponse(string responseJson)
    {
        var text = ExtractTextFromEnvelope(responseJson);

        if (string.IsNullOrWhiteSpace(text))
        {
            _logger.LogWarning("Empty text in Gemini response");
            return null;
        }

        text = StripMarkdownFences(text);

        var result = TryDeserialize(text);
        if (result != null)
        {
            return result;
        }

        var jsonSubstring = ExtractJsonSubstring(text);
        if (jsonSubstring != null)
        {
            return TryDeserialize(jsonSubstring);
        }

        return null;
    }

    private static string StripMarkdownFences(string text)
    {
        var trimmed = text.Trim();

        if (trimmed.StartsWith("```"))
        {
            var firstNewline = trimmed.IndexOf('\n');
            if (firstNewline >= 0)
            {
                trimmed = trimmed[(firstNewline + 1)..];
            }

            if (trimmed.TrimEnd().EndsWith("```"))
            {
                trimmed = trimmed.TrimEnd();
                trimmed = trimmed[..^3];
            }
        }

        return trimmed.Trim();
    }

    private static string? ExtractJsonSubstring(string text)
    {
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');

        if (start < 0 || end <= start)
        {
            return null;
        }

        return text[start..(end + 1)];
    }

    private TranslationResult? TryDeserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            var result = JsonSerializer.Deserialize<TranslationResult>(json, SerializerOptions);
            if (result != null && !string.IsNullOrWhiteSpace(result.Translation))
            {
                return result;
            }
        }
        catch (JsonException)
        {
            // битый JSON — вернём null и попробуем другой способ
        }

        return null;
    }

    private static string TruncateForLog(string text)
    {
        const int maxLength = 1000;
        return text.Length <= maxLength ? text : text[..maxLength] + "...(truncated)";
    }
}

public class TranslationResult
{
    public string Translation { get; set; } = string.Empty;
    public List<string>? Alternatives { get; set; }
    public string? PartOfSpeech { get; set; }
    public List<ExampleSentence>? Examples { get; set; }

    // Откуда пришёл перевод: "level_map" | "ai" | "gtx"
    public string? Source { get; set; }
}

public class ExampleSentence
{
    public string English { get; set; } = string.Empty;
    public string Translation { get; set; } = string.Empty;
}
