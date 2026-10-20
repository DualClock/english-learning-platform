using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

public class AiService
{
    private static readonly string[] FallbackModels =
    {
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash"
    };

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(24);

    // Прямой клиент БЕЗ прокси — для бесплатных эндпоинтов, доступных напрямую
    private static readonly HttpClient DirectHttpClient = new(new HttpClientHandler { UseProxy = false })
    {
        Timeout = TimeSpan.FromSeconds(5)
    };

    // Клиент для перевода целых предложений/абзацев: без прокси, но с более
    // длинным таймаутом, чем у DirectHttpClient (5с), — 10с
    private static readonly HttpClient TextTranslateHttpClient = new(new HttpClientHandler { UseProxy = false })
    {
        Timeout = TimeSpan.FromSeconds(10)
    };

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

        var translation = await TranslateViaGtxAsync(normalized, TextTranslateHttpClient);
        if (translation != null)
        {
            _cache.Set(cacheKey, translation, TextTranslateCacheTtl);
        }

        return translation;
    }

    // Литературный перевод страницы en→ru через Gemini (с прокси и fallback-моделями),
    // при ошибке — fallback на gtx-перевод TranslateTextAsync. Кэш 24ч, ключ от SHA256 текста.
    public async Task<string?> TranslateLiteraryAsync(string text)
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
                    requestType: "translate_literary");
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

            using var response = await httpClient.GetAsync(url);
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
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Google translate failed for text of length {Length}", text.Length);
            return null;
        }
    }

    private async Task<TranslationResult?> TranslateWithGoogleAsync(string word)
    {
        var translation = await TranslateViaGtxAsync(word, DirectHttpClient);
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
