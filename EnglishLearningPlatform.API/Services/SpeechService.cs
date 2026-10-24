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
public class SpeechService : IAiBackedService
{
    private const string TtsModel = "gemini-2.5-flash-preview-tts";
    private const string TtsVoice = "Kore";
    private const int DefaultSampleRate = 24000;
    private const int MaxTextLength = 300;

    private const string TranscriptionPrompt =
        "Transcribe the English speech exactly. Return only the transcription, " +
        "without quotes, comments or punctuation notes. If there is no speech, return an empty string.";

    // Модели, умеющие слушать аудио. Первая рабочая запоминается на процесс.
    // 2.5-flash больше не выдаётся новым проектам (404 "no longer available"),
    // поэтому список начинается с актуальных моделей, а Gemini:Model
    // подставляется первым кандидатом в TranscribeAsync.
    private static readonly string[] TranscriptionModels =
    {
        "gemini-3.8-flash",
        "gemini-flash-latest",
        "gemini-3.5-flash"
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

    /// <summary>Аудио озвучки вместе с типом, который надо отдать клиенту.</summary>
    public sealed record TtsAudio(byte[] Data, string ContentType);

    /// <summary>
    /// После исчерпания квоты Gemini на TTS бесполезно ретраить её на каждый клик:
    /// три попытки с backoff — это 7–10 секунд ожидания вместо готового резерва.
    /// Кулдаун вместо «до полуночи»: момент сброса RPD у провайдера не наш контракт,
    /// а через полчаса дешёвая проверка сама покажет, вернулась ли квота.
    /// </summary>
    public static readonly TimeSpan TtsQuotaCooldown = TimeSpan.FromMinutes(30);

    private static DateTime _ttsGeminiRetryAfterUtc = DateTime.MinValue;
    private static int _ttsSkipLogged;

    /// <summary>Пора ли пропустить Gemini и сразу взять бесплатный голос.</summary>
    public static bool ShouldSkipGeminiTts(DateTime utcNow, DateTime retryAfterUtc) => utcNow < retryAfterUtc;

    private static void BlockTtsGemini() =>
        _ttsGeminiRetryAfterUtc = DateTime.UtcNow + TtsQuotaCooldown;

    /// <summary>
    /// Озвучивает текст: кэш на диске → Gemini (лучший голос, но бесплатная квота
    /// 100 запросов в сутки на модель) → бесплатный Google Translate TTS.
    /// null — если не сработал ни один провайдер.
    /// </summary>
    public async Task<TtsAudio?> SynthesizeAsync(
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

        var packPath = FindPackFile(normalized);
        if (packPath != null)
        {
            try
            {
                return new TtsAudio(await File.ReadAllBytesAsync(packPath, cancellationToken), "audio/mpeg");
            }
            catch (IOException ex)
            {
                _logger.LogWarning(ex, "Failed to read packed TTS file");
            }
        }

        var wavPath = GetCachePath(normalized);
        if (File.Exists(wavPath))
        {
            try
            {
                return new TtsAudio(await File.ReadAllBytesAsync(wavPath, cancellationToken), "audio/wav");
            }
            catch (IOException ex)
            {
                // Файл занят другим запросом — просто идём в провайдера
                _logger.LogWarning(ex, "Failed to read cached TTS file");
            }
        }

        var gtxPath = GetGtxCachePath(normalized);
        if (File.Exists(gtxPath))
        {
            try
            {
                return new TtsAudio(await File.ReadAllBytesAsync(gtxPath, cancellationToken), "audio/mpeg");
            }
            catch (IOException ex)
            {
                _logger.LogWarning(ex, "Failed to read cached GTX audio");
            }
        }

        byte[]? gemini = null;

        if (ShouldSkipGeminiTts(DateTime.UtcNow, _ttsGeminiRetryAfterUtc))
        {
            // Кулдаун: квоту уже ловили в этой волне кликов — не тратим 7–10 секунд на ретраи
            if (Interlocked.CompareExchange(ref _ttsSkipLogged, 1, 0) == 0)
            {
                _logger.LogInformation(
                    "TTS: квота Gemini исчерпана, до {Until:HH:mm} UTC озвучиваю бесплатным резервом",
                    _ttsGeminiRetryAfterUtc);
            }
        }
        else
        {
            try
            {
                gemini = await SynthesizeGeminiAsync(normalized, userId, cancellationToken);
                if (gemini != null)
                {
                    Interlocked.Exchange(ref _ttsSkipLogged, 0);
                }
            }
            catch (AiQuotaExceededException)
            {
                // Личная квота исчерпана — не ошибка пользователю, а повод взять бесплатный голос
                BlockTtsGemini();
                _logger.LogInformation("TTS: квота пользователя исчерпана, переключаюсь на бесплатный голос");
            }
            catch (AiGlobalBudgetExceededException)
            {
                BlockTtsGemini();
                _logger.LogInformation("TTS: суточный бюджет Gemini исчерпан, переключаюсь на бесплатный голос");
            }
            catch (AiUnavailableException ex)
            {
                _logger.LogWarning("TTS: Gemini недоступен ({Reason}), переключаюсь на бесплатный голос", ex.Message);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                _logger.LogWarning("TTS: Gemini не успел за отведённое время, беру бесплатный голос");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "TTS: неожиданная ошибка Gemini, переключаюсь на бесплатный голос");
            }
        }

        if (gemini != null)
        {
            return new TtsAudio(gemini, "audio/wav");
        }

        var gtx = await SynthesizeGtxAsync(normalized, cancellationToken);
        return gtx == null ? null : new TtsAudio(gtx, "audio/mpeg");
    }

    private async Task<byte[]?> SynthesizeGeminiAsync(
        string normalized,
        string? userId,
        CancellationToken cancellationToken)
    {
        var cachePath = GetCachePath(normalized);

        var apiKey = _configuration["Gemini:ApiKey"];
        if (string.IsNullOrEmpty(apiKey))
        {
            _logger.LogError("Gemini API key is not configured");
            return null;
        }

        // Прокси до Gemini иногда собирает фразу десятки секунд (наблюдалось 56 с):
        // пользователь к этому моменту уже слышит запасной голос, а серверный слот
        // занят. Держим потолок и уходим на бесплатный резерв.
        var timeoutSeconds = Math.Clamp(_configuration.GetValue("Tts:GeminiTimeoutSeconds", 15), 3, 60);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));

        var requestBody = new
        {
            contents = new[]
            {
                new
                {
                    parts = new[] { new { text = BuildTtsPrompt(normalized) } }
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
            TtsModel, requestBody, apiKey, "tts", userId, cts.Token);

        if (result.Json == null)
        {
            _logger.LogWarning("TTS model unavailable (modelNotFound={ModelNotFound})", result.ModelNotFound);
            return null;
        }

        var (pcm, sampleRate) = ExtractAudio(result.Json);
        if (pcm == null || pcm.Length == 0)
        {
            _logger.LogWarning("TTS response contained no audio data — модель вернула текст вместо речи");
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

        // Основная модель из конфига — та же, что работает для чата
        var configuredModel = _configuration["Gemini:Model"];
        if (!string.IsNullOrWhiteSpace(configuredModel))
        {
            candidates.Add(configuredModel.Trim());
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

    private string GtxDirectory => Path.Combine(_environment.ContentRootPath, "uploads", "tts-gtx");

    /// <summary>
    /// Готовый пак озвучки слов нейроголосами Edge: файлы кладутся заранее (генератор
    /// лежит в tools/), поэтому клик по слову не зависит ни от квоты Gemini, ни от
    /// доступности провайдера. Каталог можно переопределить через Tts:PackDirectory.
    /// </summary>
    private string PackDirectory
    {
        get
        {
            var configured = _configuration["Tts:PackDirectory"];
            if (string.IsNullOrWhiteSpace(configured))
            {
                return Path.Combine(_environment.ContentRootPath, "uploads", "tts-pack");
            }

            return Path.IsPathRooted(configured)
                ? configured
                : Path.Combine(_environment.ContentRootPath, configured);
        }
    }

    /// <summary>Ключ файла в паке: слово в нижнем регистре, пробелы схлопнуты.</summary>
    public static string GetPackKey(string normalizedText) => "pack|" + normalizedText;

    /// <summary>
    /// Ищет слово в паке с учётом регистра: в тексте книги «Alice», в словаре «alice».
    /// </summary>
    private string? FindPackFile(string normalized)
    {
        foreach (var candidate in new[] { normalized, normalized.ToLowerInvariant() }.Distinct())
        {
            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(GetPackKey(candidate))))
                .ToLowerInvariant();
            var path = Path.Combine(PackDirectory, hash + ".mp3");
            if (File.Exists(path))
            {
                return path;
            }
        }

        return null;
    }

    private string GetGtxCachePath(string normalizedText)
    {
        var key = $"gtx|en|0.9|{normalizedText}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();
        return Path.Combine(GtxDirectory, hash + ".mp3");
    }

    /// <summary>
    /// Адрес бесплатной озвучки Google Translate — тот же контур, что уже используется
    /// для перевода слова. Не требует ключа; отдаёт MP3 24 кГц.
    /// </summary>
    public static string BuildGtxUrl(string text) =>
        "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&ttsspeed=0.9&q=" +
        Uri.EscapeDataString(text);

    /// <summary>Отличает MP3 от HTML-заглушки, которую endpoint иногда отдаёт с кодом 200.</summary>
    public static bool LooksLikeMp3(byte[] data) =>
        (data.Length > 3 && data[0] == 0x49 && data[1] == 0x44 && data[2] == 0x33) ||
        (data.Length > 1 && data[0] == 0xFF && (data[1] & 0xE0) == 0xE0);

    private static readonly HttpClient GtxClient = CreateGtxClient();

    private static HttpClient CreateGtxClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
        // Без браузерного User-Agent endpoint отвечает 403 — проверено с сервера руками.
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "Mozilla/5.0");
        return client;
    }

    /// <summary>
    /// Бесплатный резерв озвучки. Нужен, когда суточная квота Gemini на TTS (100
    /// запросов на бесплатном тарифе) исчерпана: лучше ровный естественный голос,
    /// чем робот из браузера.
    /// </summary>
    private async Task<byte[]?> SynthesizeGtxAsync(string normalized, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await GtxClient.GetAsync(BuildGtxUrl(normalized), cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("GTX TTS ответил HTTP {Status}", (int)response.StatusCode);
                return null;
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            if (bytes.Length < 1024 || !LooksLikeMp3(bytes))
            {
                _logger.LogWarning("GTX TTS вернул не аудио ({Size} байт)", bytes.Length);
                return null;
            }

            try
            {
                Directory.CreateDirectory(GtxDirectory);
                await File.WriteAllBytesAsync(GetGtxCachePath(normalized), bytes, cancellationToken);
            }
            catch (IOException ex)
            {
                _logger.LogWarning(ex, "Failed to cache GTX audio");
            }

            return bytes;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "GTX TTS недоступен");
            return null;
        }
    }

    // Схлопываем пробелы и переводы строк: для озвучки это шум,
    // но именно от текста зависит хэш кэша — нормализуем до него
    private static string NormalizeText(string text) =>
        string.Join(' ', (text ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    /// <summary>
    /// Оборачивает текст в кавычки перед отправкой в TTS-модель.
    ///
    /// Замерено на проде 24.10: на одиночное слово вроде `cheshire` или
    /// `Cheshire Cat` модель отвечала HTTP 200 без аудиочасти (то есть генерировала
    /// текст, которого мы не ждём) или 400 «Model tried to generate text, but it
    /// should only be used for TTS». Кавычки дают модели однозначный сигнал «это
    /// реплика, её надо произнести» и починили оба случая. В кэш идёт исходный
    /// нормализованный текст (см. GetCachePath), поэтому одна и та же фраза не
    /// дублируется в зависимости от обёртки.
    /// </summary>
    public static string BuildTtsPrompt(string normalizedText) =>
        string.Concat("\"", normalizedText, "\"");

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
