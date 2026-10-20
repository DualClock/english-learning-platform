using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Речь через Gemini: озвучка (TTS) и распознавание (ASR).
/// TTS возвращает PCM 24 кГц — оборачиваем в WAV-заголовок и кэшируем файлом
/// uploads/tts/{sha256}.wav, поэтому повторная озвучка той же фразы не тратит
/// ни квоту, ни время провайдера.
/// </summary>
public class SpeechService
{
    private const string TtsModel = "gemini-2.5-flash-preview-tts";
    private const string TtsVoice = "Kore";
    private const int DefaultSampleRate = 24000;
    private const int MaxTextLength = 300;

    private const string TranscriptionPrompt =
        "Transcribe the English speech exactly. Return only the transcription, " +
        "without quotes, comments or punctuation notes. If there is no speech, return an empty string.";

    // Модели, умеющие слушать аудио. Первая рабочая запоминается на процесс.
    private static readonly string[] TranscriptionModels =
    {
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash"
    };

    private static string? _resolvedTranscriptionModel;

    private readonly IConfiguration _configuration;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<SpeechService> _logger;
    private readonly ResilientAiService _resilient;

    public SpeechService(
        IConfiguration configuration,
        IWebHostEnvironment environment,
        ILogger<SpeechService> logger,
        ResilientAiService resilient)
    {
        _configuration = configuration;
        _environment = environment;
        _logger = logger;
        _resilient = resilient;
    }

    private string TtsDirectory => Path.Combine(_environment.ContentRootPath, "uploads", "tts");

    /// <summary>
    /// Озвучивает текст и возвращает WAV-байты. null — если провайдер не отдал аудио.
    /// </summary>
    public async Task<byte[]?> SynthesizeAsync(
        string text,
        string? userId,
        CancellationToken cancellationToken = default)
    {
        var normalized = NormalizeText(text);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return null;
        }

        if (normalized.Length > MaxTextLength)
        {
            normalized = normalized[..MaxTextLength];
        }

        var cachePath = GetCachePath(normalized);
        if (File.Exists(cachePath))
        {
            try
            {
                return await File.ReadAllBytesAsync(cachePath, cancellationToken);
            }
            catch (IOException ex)
            {
                // Файл занят другим запросом — просто идём в провайдера
                _logger.LogWarning(ex, "Failed to read cached TTS file");
            }
        }

        var apiKey = _configuration["Gemini:ApiKey"];
        if (string.IsNullOrEmpty(apiKey))
        {
            _logger.LogError("Gemini API key is not configured");
            return null;
        }

        var requestBody = new
        {
            contents = new[]
            {
                new
                {
                    parts = new[] { new { text = normalized } }
                }
            },
            generationConfig = new
            {
                responseModalities = new[] { "AUDIO" },
                speechConfig = new
                {
                    voiceConfig = new
                    {
                        prebuiltVoiceConfig = new { voiceName = TtsVoice }
                    }
                }
            }
        };

        var result = await _resilient.SendAsync(
            TtsModel, requestBody, apiKey, "tts", userId, cancellationToken);

        if (result.Json == null)
        {
            _logger.LogWarning("TTS model unavailable (modelNotFound={ModelNotFound})", result.ModelNotFound);
            return null;
        }

        var (pcm, sampleRate) = ExtractAudio(result.Json);
        if (pcm == null || pcm.Length == 0)
        {
            _logger.LogWarning("TTS response contained no audio data");
            return null;
        }

        var wav = WrapWav(pcm, sampleRate);

        try
        {
            Directory.CreateDirectory(TtsDirectory);
            await File.WriteAllBytesAsync(cachePath, wav, cancellationToken);
        }
        catch (IOException ex)
        {
            // Кэш — оптимизация, а не условие работы: отдаём аудио как есть
            _logger.LogWarning(ex, "Failed to cache TTS file");
        }

        return wav;
    }

    /// <summary>
    /// Распознаёт английскую речь из аудио (base64). null — если распознать не удалось.
    /// </summary>
    public async Task<string?> TranscribeAsync(
        string audioBase64,
        string mimeType,
        string? userId,
        CancellationToken cancellationToken = default)
    {
        var apiKey = _configuration["Gemini:ApiKey"];
        if (string.IsNullOrEmpty(apiKey))
        {
            _logger.LogError("Gemini API key is not configured");
            return null;
        }

        var candidates = new List<string>();
        if (_resolvedTranscriptionModel != null)
        {
            candidates.Add(_resolvedTranscriptionModel);
        }

        candidates.AddRange(TranscriptionModels);
        candidates = candidates.Distinct().ToList();

        foreach (var model in candidates)
        {
            var generationConfig = new Dictionary<string, object>
            {
                ["temperature"] = 0.0,
                ["maxOutputTokens"] = 400
            };

            if (IsThinkingModel(model))
            {
                // Размышления тут только съедают лимит и время
                generationConfig["thinkingConfig"] = new { thinkingBudget = 0 };
            }

            var requestBody = new
            {
                contents = new[]
                {
                    new
                    {
                        role = "user",
                        parts = new object[]
                        {
                            new { text = TranscriptionPrompt },
                            new { inlineData = new { mimeType, data = audioBase64 } }
                        }
                    }
                },
                generationConfig
            };

            var result = await _resilient.SendAsync(
                model, requestBody, apiKey, "transcribe", userId, cancellationToken);

            if (result.Json != null)
            {
                _resolvedTranscriptionModel = model;
                return ExtractText(result.Json);
            }

            if (!result.ModelNotFound)
            {
                // Ошибка не про модель (квота, 400 на формате и т.п.) — перебор не поможет
                return null;
            }
        }

        _logger.LogError("No working Gemini model for transcription");
        return null;
    }

    private string GetCachePath(string normalizedText)
    {
        var key = $"{TtsVoice}|{DefaultSampleRate}|{normalizedText}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();
        return Path.Combine(TtsDirectory, hash + ".wav");
    }

    // Схлопываем пробелы и переводы строк: для озвучки это шум,
    // но именно от текста зависит хэш кэша — нормализуем до него
    private static string NormalizeText(string text) =>
        string.Join(' ', (text ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    private static bool IsThinkingModel(string model) =>
        model.Contains("2.5", StringComparison.Ordinal) ||
        model.Contains("3.", StringComparison.Ordinal);

    // Ответ TTS: candidates[0].content.parts[0].inlineData.data (base64 PCM),
    // mimeType вида "audio/L16;codec=pcm;rate=24000"
    private static (byte[]? Pcm, int SampleRate) ExtractAudio(string responseJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseJson);
            if (!doc.RootElement.TryGetProperty("candidates", out var candidates) ||
                candidates.ValueKind != JsonValueKind.Array ||
                candidates.GetArrayLength() == 0)
            {
                return (null, DefaultSampleRate);
            }

            if (!candidates[0].TryGetProperty("content", out var content) ||
                !content.TryGetProperty("parts", out var parts) ||
                parts.ValueKind != JsonValueKind.Array)
            {
                return (null, DefaultSampleRate);
            }

            foreach (var part in parts.EnumerateArray())
            {
                JsonElement inline;
                var hasInline = part.TryGetProperty("inlineData", out inline) ||
                                part.TryGetProperty("inline_data", out inline);
                if (!hasInline || inline.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                if (!inline.TryGetProperty("data", out var dataEl) ||
                    dataEl.ValueKind != JsonValueKind.String)
                {
                    continue;
                }

                var base64 = dataEl.GetString();
                if (string.IsNullOrWhiteSpace(base64))
                {
                    continue;
                }

                var sampleRate = DefaultSampleRate;
                if (inline.TryGetProperty("mimeType", out var mimeEl) &&
                    mimeEl.GetString() is { } mime)
                {
                    sampleRate = ParseSampleRate(mime, sampleRate);
                }

                return (Convert.FromBase64String(base64), sampleRate);
            }
        }
        catch (Exception ex) when (ex is JsonException or FormatException)
        {
            // битый ответ — наверх уйдёт null
        }

        return (null, DefaultSampleRate);
    }

    private static int ParseSampleRate(string mimeType, int fallback)
    {
        const string marker = "rate=";
        var idx = mimeType.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (idx < 0)
        {
            return fallback;
        }

        var tail = mimeType[(idx + marker.Length)..];
        var digits = new string(tail.TakeWhile(char.IsDigit).ToArray());
        return int.TryParse(digits, out var rate) && rate > 0 ? rate : fallback;
    }

    // PCM 16 бит моно -> WAV (RIFF). Без заголовка браузер такой поток не играет.
    private static byte[] WrapWav(byte[] pcm, int sampleRate)
    {
        const short channels = 1;
        const short bitsPerSample = 16;
        var byteRate = sampleRate * channels * bitsPerSample / 8;
        var blockAlign = (short)(channels * bitsPerSample / 8);

        using var stream = new MemoryStream(44 + pcm.Length);
        using var writer = new BinaryWriter(stream);

        writer.Write(Encoding.ASCII.GetBytes("RIFF"));
        writer.Write(36 + pcm.Length);
        writer.Write(Encoding.ASCII.GetBytes("WAVE"));
        writer.Write(Encoding.ASCII.GetBytes("fmt "));
        writer.Write(16);
        writer.Write((short)1); // PCM
        writer.Write(channels);
        writer.Write(sampleRate);
        writer.Write(byteRate);
        writer.Write(blockAlign);
        writer.Write(bitsPerSample);
        writer.Write(Encoding.ASCII.GetBytes("data"));
        writer.Write(pcm.Length);
        writer.Write(pcm);
        writer.Flush();

        return stream.ToArray();
    }

    private static string? ExtractText(string responseJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseJson);
            if (!doc.RootElement.TryGetProperty("candidates", out var candidates) ||
                candidates.ValueKind != JsonValueKind.Array ||
                candidates.GetArrayLength() == 0)
            {
                return null;
            }

            if (!candidates[0].TryGetProperty("content", out var content) ||
                !content.TryGetProperty("parts", out var parts) ||
                parts.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            var builder = new StringBuilder();
            foreach (var part in parts.EnumerateArray())
            {
                if (part.TryGetProperty("text", out var textEl) &&
                    textEl.ValueKind == JsonValueKind.String)
                {
                    builder.Append(textEl.GetString());
                }
            }

            var text = builder.ToString().Trim().Trim('"').Trim();
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
