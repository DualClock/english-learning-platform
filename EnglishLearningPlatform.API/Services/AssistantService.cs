using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

public class AssistantService
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

    private static readonly TimeSpan AnalyzeCacheTtl = TimeSpan.FromHours(24);
    private static string? _resolvedModel;

    private const int MaxHistoryMessages = 12;

    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _cache;
    private readonly ILogger<AssistantService> _logger;
    private readonly ResilientAiService _resilient;
    private readonly ApplicationDbContext _context;

    public AssistantService(
        IConfiguration configuration,
        IMemoryCache cache,
        ILogger<AssistantService> logger,
        ResilientAiService resilient,
        ApplicationDbContext context)
    {
        _configuration = configuration;
        _cache = cache;
        _logger = logger;
        _resilient = resilient;
        _context = context;
    }

    public async Task<string?> ChatAsync(List<AssistantChatMessage>? messages, string? userLevel, string? userId = null)
    {
        var apiKey = _configuration["Gemini:ApiKey"];
        if (string.IsNullOrEmpty(apiKey))
        {
            _logger.LogError("Gemini API key is not configured");
            return null;
        }

        var level = NormalizeLevel(userLevel);
        var systemPrompt =
            "You are Alex, a friendly native English speaker chatting with a language learner. " +
            $"Their CEFR level: {level}. " +
            "Keep your replies SHORT (2-4 sentences), warm and conversational like real spoken English. " +
            "Use natural everyday vocabulary matching their level (slightly stretch it). " +
            "Always end with a light follow-up question to keep the conversation going. " +
            "Never correct the user in the main reply — corrections come from a separate tool. " +
            "Never use markdown formatting.";

        var contents = new List<object>();
        var history = (messages ?? new List<AssistantChatMessage>())
            .Where(m => !string.IsNullOrWhiteSpace(m.Text))
            .TakeLast(MaxHistoryMessages);

        foreach (var message in history)
        {
            var role = message.Role == "assistant" ? "model" : "user";
            contents.Add(new
            {
                role,
                parts = new[] { new { text = message.Text.Trim() } }
            });
        }

        if (contents.Count == 0)
        {
            // Пустая история — Alex здоровается сам
            contents.Add(new
            {
                role = "user",
                parts = new[]
                {
                    new { text = "(The conversation has just started. Greet the learner warmly and ask a light, friendly question.)" }
                }
            });
        }

        var responseJson = await CallGeminiAsync(
            systemPrompt,
            contents,
            temperature: 0.8,
            maxOutputTokens: 300,
            apiKey,
            requestType: "assistant_chat",
            userId: userId);

        if (responseJson == null)
        {
            return null;
        }

        var reply = ExtractTextFromEnvelope(responseJson);
        if (string.IsNullOrWhiteSpace(reply))
        {
            _logger.LogWarning("Empty text in Gemini assistant chat response");
            return null;
        }

        return reply.Trim();
    }

    public async Task<AssistantAnalysis?> AnalyzeAsync(string text, string? userLevel, string? userId = null)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var apiKey = _configuration["Gemini:ApiKey"];
        if (string.IsNullOrEmpty(apiKey))
        {
            _logger.LogError("Gemini API key is not configured");
            return null;
        }

        var level = NormalizeLevel(userLevel);

        var cacheKey = "assistant-analyze:" + Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes($"{level}|{text.Trim()}")))[..32];
        if (_cache.TryGetValue(cacheKey, out AssistantAnalysis? cached) && cached != null)
        {
            // Разбор мог быть получен другим запросом — в банк ошибок всё равно
            // пишем: дедупликация не даст задвоить записи
            await SaveIssuesAsync(userId, cached.Issues);
            return cached;
        }

        var prompt =
            "You are an English teacher analyzing what a learner wrote (conversational English). " +
            $"Learner level: {level}. Text: \"{text}\". " +
            "Respond ONLY with JSON: " +
            "{\"score\": <0-100 overall quality>, \"isCorrect\": <bool no significant errors>, " +
            "\"issues\": [{\"type\": \"grammar|word_choice|naturalness\", " +
            "\"original\": \"<fragment from user text>\", \"suggestion\": \"<better>\", " +
            "\"explanation\": \"<кратко по-русски почему>\"}], " +
            "\"betterVersion\": \"<natural improved version of the whole message>\", " +
            "\"praise\": \"<1 короткое живое поощрение по-русски>\"}. " +
            "If the text is already perfect, issues: [] and say so in praise.";

        var contents = new List<object>
        {
            new { role = "user", parts = new[] { new { text = prompt } } }
        };

        var responseJson = await CallGeminiAsync(
            systemPrompt: null,
            contents,
            temperature: 0.2,
            maxOutputTokens: 2048,
            apiKey,
            requestType: "assistant_analyze",
            userId: userId);

        if (responseJson == null)
        {
            return null;
        }

        var result = ParseAnalysis(ExtractTextFromEnvelope(responseJson));
        if (result == null)
        {
            _logger.LogWarning("Failed to parse assistant analysis for text: {Text}",
                TruncateForLog(text));
            return null;
        }

        _cache.Set(cacheKey, result, AnalyzeCacheTtl);

        await SaveIssuesAsync(userId, result.Issues);

        return result;
    }

    /// <summary>
    /// Складывает разобранные ошибки в банк пользователя. Дубликатом считается
    /// пара original+suggestion среди нерешённых — повторный разбор того же
    /// сообщения не плодит записи.
    /// </summary>
    private async Task SaveIssuesAsync(string? userId, List<AssistantIssue>? issues)
    {
        if (string.IsNullOrEmpty(userId) || issues == null || issues.Count == 0)
        {
            return;
        }

        try
        {
            var existing = await _context.UserErrorBankEntries
                .Where(e => e.UserId == userId && e.ResolvedAt == null)
                .Select(e => new { e.Original, e.Suggestion })
                .ToListAsync();

            var seen = existing
                .Select(e => (e.Original.ToLowerInvariant(), e.Suggestion.ToLowerInvariant()))
                .ToHashSet();

            foreach (var issue in issues.Take(10))
            {
                var original = Cut(issue.Original, 500);
                var suggestion = Cut(issue.Suggestion, 500);

                if (original.Length == 0 || suggestion.Length == 0)
                {
                    continue;
                }

                if (!seen.Add((original.ToLowerInvariant(), suggestion.ToLowerInvariant())))
                {
                    continue;
                }

                _context.UserErrorBankEntries.Add(new UserErrorBankEntry
                {
                    UserId = userId,
                    Original = original,
                    Suggestion = suggestion,
                    Type = Cut(issue.Type, 30) is { Length: > 0 } type ? type : "grammar",
                    Explanation = Cut(issue.Explanation, 1000)
                });
            }

            await _context.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // Банк ошибок — побочный эффект разбора: его сбой не должен ломать ответ
            _logger.LogWarning(ex, "Failed to save error bank entries");
        }
    }

    private static string Cut(string? value, int maxLength)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    private async Task<string?> CallGeminiAsync(
        string? systemPrompt,
        List<object> contents,
        double temperature,
        int maxOutputTokens,
        string apiKey,
        string requestType,
        string? userId)
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

        foreach (var model in candidates)
        {
            var generationConfig = new Dictionary<string, object>
            {
                ["temperature"] = temperature,
                ["maxOutputTokens"] = maxOutputTokens
            };
            if (IsThinkingModel(model))
            {
                // У thinking-моделей (2.5+) без этого лимит съедается размышлениями
                generationConfig["thinkingConfig"] = new { thinkingBudget = 0 };
            }

            var requestBody = new
            {
                systemInstruction = systemPrompt == null
                    ? null
                    : new { parts = new[] { new { text = systemPrompt } } },
                contents = contents.ToArray(),
                generationConfig
            };

            var (json, modelNotFound) = await _resilient.SendAsync(
                model, requestBody, apiKey, requestType, userId);
            if (json != null)
            {
                if (_resolvedModel != model)
                {
                    _resolvedModel = model;
                    _logger.LogInformation("Gemini model selected for assistant: {Model}", model);
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

            _logger.LogWarning("Gemini model {Model} not found for assistant, trying next fallback", model);
        }

        _logger.LogError("No working Gemini model found for assistant");
        return null;
    }

    private AssistantAnalysis? ParseAnalysis(string? rawText)
    {
        if (string.IsNullOrWhiteSpace(rawText))
        {
            return null;
        }

        var text = StripMarkdownFences(rawText);

        var result = TryDeserializeAnalysis(text) ?? TryDeserializeAnalysis(ExtractJsonSubstring(text));
        if (result == null)
        {
            return null;
        }

        result.Score = Math.Clamp(result.Score, 0, 100);
        result.Issues = (result.Issues ?? new List<AssistantIssue>())
            .Where(i => !string.IsNullOrWhiteSpace(i.Original) && !string.IsNullOrWhiteSpace(i.Suggestion))
            .ToList();
        result.BetterVersion ??= string.Empty;
        result.Praise ??= string.Empty;

        return result;
    }

    private AssistantAnalysis? TryDeserializeAnalysis(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<AssistantAnalysis>(json, SerializerOptions);
        }
        catch (JsonException)
        {
            // битый JSON — вернём null и попробуем другой способ
            return null;
        }
    }

    private static string NormalizeLevel(string? userLevel)
    {
        var level = userLevel?.Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(level) ? "b1" : level;
    }

    private static bool IsThinkingModel(string model) =>
        model.Contains("2.5", StringComparison.Ordinal) ||
        model.Contains("3.", StringComparison.Ordinal);

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

    private static string TruncateForLog(string text)
    {
        const int maxLength = 1000;
        return text.Length <= maxLength ? text : text[..maxLength] + "...(truncated)";
    }
}

public class AssistantChatMessage
{
    public string Role { get; set; } = "user";
    public string Text { get; set; } = string.Empty;
}

public class AssistantAnalysis
{
    public int Score { get; set; }
    public bool IsCorrect { get; set; }
    public List<AssistantIssue>? Issues { get; set; }
    public string? BetterVersion { get; set; }
    public string? Praise { get; set; }
}

public class AssistantIssue
{
    public string Type { get; set; } = "grammar";
    public string? Original { get; set; }
    public string? Suggestion { get; set; }
    public string? Explanation { get; set; }
}
