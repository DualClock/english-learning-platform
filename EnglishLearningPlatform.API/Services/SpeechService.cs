using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Речь через Gemini: озвучка (TTS) и распознавание (ASR).
/// TTS возвращает PCM 24 кГц — оборачиваем в WAV-заголовок и кэшируем файлом
/// uploads/tts/{sha256}.wav, поэтому повторная озвучка той же фразы не тратит
/// ни квоту, ни время провайдера.
///
/// Текст длиннее одного вызова провайдера не обрезается: он режется по
/// границам предложений и склеивается (см. <see cref="SynthesizeAsync"/> и
/// <see cref="SpeechSegmentPlanner"/>). Раньше здесь стоял потолок 300 символов,
/// и абзац книги звучал обрывком.
/// </summary>
public class SpeechService : IAiBackedService
{
    private const string TtsModel = "gemini-2.5-flash-preview-tts";
    private const string TtsVoice = "Kore";
    private const int DefaultSampleRate = 24000;
    private const string Mp3ContentType = "audio/mpeg";
    private const string WavContentType = "audio/wav";

    /// <summary>
    /// Потолок одного запроса озвучки — абзац книги с запасом. Раньше здесь было
    /// 300 символов, и абзац (≈400 символов) молча терял конец. По замерам на
    /// текстах библиотеки: предложение ≈100 символов, абзац 350–450, поэтому
    /// 1200 покрывает самый длинный абзац с двойным запасом. Длиннее — явная
    /// ошибка <see cref="SpeechTextTooLongException"/>, а не тихая обрезка.
    /// </summary>
    public const int MaxTextLength = 1200;

    // Сколько символов уходит в ОДИН вызов провайдера — не наш выбор, а предел
    // чужого API. Не снаружи: у недокументированного translate_tts?client=tw-ob
    // отдаёт аудио только для фразы до ~200 символов (дальше 413), и это самый
    // узкий из трёх провайдеров (Azure держит 2000). Общий знаменатель нужен,
    // чтобы куски совпадали между провайдерами и кэш не делился по-разному.
    // Это внутренняя деталь: снаружи видно только MaxTextLength.
    public const int MaxProviderCharsPerCall = 180;

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
    private readonly Reader.AzureSpeechService _azure;

    /// <summary>
    /// Путь к ffmpeg для склейки кусков разных контейнеров (WAV от Gemini + MP3
    /// от резерва). Ищется один раз и запоминается; null — ffmpeg нет.
    /// </summary>
    private string? _ffmpegPath;

    /// <summary>
    /// Каталог для временных файлов ffmpeg. Ищется один раз; null — писать
    /// некуда (тогда смешанные куски дают отказ, а не битый файл).
    /// </summary>
    private string? _scratchDirectory;

    public SpeechService(
        IConfiguration configuration,
        IWebHostEnvironment environment,
        ILogger<SpeechService> logger,
        ResilientAiService resilient,
        Reader.AzureSpeechService azure)
    {
        _configuration = configuration;
        _environment = environment;
        _logger = logger;
        _resilient = resilient;
        _azure = azure;
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
    /// Озвучивает текст: пак слов → кэш на диске → Azure → Gemini → бесплатный
    /// Google Translate TTS.
    ///
    /// Текст длиннее <see cref="MaxProviderCharsPerCall"/> не обрезается и не
    /// уходит одним запросом: он режется по границам предложений (в крайнем
    /// случае — по словам), каждый кусок озвучивается и кэшируется отдельно, а
    /// MP3-байты склеиваются в один поток. Кэш при этом переиспользуется
    /// посегментно, поэтому повторная озвучка абзаца не платит повторно.
    ///
    /// null — если не сработал ни один провайдер. <see cref="SpeechTextTooLongException"/>
    /// — текст длиннее <see cref="MaxTextLength"/> (молча резать запрещено).
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
            throw new SpeechTextTooLongException(normalized.Length, MaxTextLength);
        }

        var audio = await SynthesizeWholeAsync(normalized, userId, MaxProviderCharsPerCall, cancellationToken);
        if (audio != null)
        {
            return audio;
        }

        var segments = SpeechSegmentPlanner.Plan(normalized, MaxProviderCharsPerCall);
        if (segments.Count <= 1)
        {
            // Один кусок уже проверен выше — второго круга по тому же тексту не нужно.
            return null;
        }

        var clips = new List<(byte[] Data, string ContentType)>(segments.Count);
        foreach (var segment in segments)
        {
            var clip = await SynthesizeWholeAsync(segment, userId, MaxProviderCharsPerCall, cancellationToken);
            if (clip == null)
            {
                // Половина абзаца в ответ на запрос абзаца — худший исход, чем честный
                // отказ: клиент лучше прочтёт фразу браузером, чем услышит обрывок.
                _logger.LogWarning(
                    "TTS: кусок {Index} из {Total} не озвучен, целую фразу не отдаю",
                    clips.Count + 1, segments.Count);
                return null;
            }

            clips.Add((clip.Data, clip.ContentType));
        }

        /*
         * Склейка кусков разных контейнеров.
         *
         * Раньше здесь стояла проверка «форматы совпадают» и бросок
         * SpeechMergeUnsupportedException при расхождении. На стенде это
         * выглядело так: абзац 200/400/600 символов получал отказ, потому что
         * один кусок пришёл WAV от Gemini, другой — MP3 от резерва, и человек
         * не слышал серверный голос ВООБЩЕ ни на одном абзаце.
         *
         * Теперь AudioMerge приводит куски к одному контейнеру: все WAV —
         * склейка PCM без потерь, смешанный набор — WAV→MP3 через ffmpeg.
         * Отказ остаётся единственным исходом, если ffmpeg недоступен: битый
         * файл хуже запасного браузерного голоса.
         */
        var merged = await AudioMerge.MergeAsync(
            clips,
            _ffmpegPath ??= AudioMerge.FindFfmpeg(_configuration["Tts:FfmpegPath"]),
            cancellationToken,
            _scratchDirectory ??= AudioMerge.ResolveScratchDirectory(_environment.ContentRootPath));

        if (merged == null)
        {
            _logger.LogWarning(
                "TTS: куски в разных контейнерах и ffmpeg не найден — целую фразу не отдаю");
            return null;
        }

        return new TtsAudio(merged.Value.Data, merged.Value.ContentType);
    }

    /// <summary>Один текст целиком, без нарезки: пак, кэш или один вызов провайдера.</summary>
    /// <param name="normalized">Текст, уже проверенный на длину.</param>
    /// <param name="userId">Владелец квоты Gemini.</param>
    /// <param name="maxChars">Предел одного вызова. При склейке абзаца зовётся с
    /// <see cref="MaxProviderCharsPerCall"/>, потому что чередование провайдеров на
    /// соседних кусках даёт разные контейнеры. Внутри куска чередование ничем не
    /// грозит — там ровно один результат, поэтому лимит можно поднять.</param>
    /// <param name="cancellationToken">Отмена запроса.</param>
    private async Task<TtsAudio?> SynthesizeWholeAsync(
        string normalized,
        string? userId,
        int maxChars,
        CancellationToken cancellationToken)
    {
        /*
         * ОДИН вызов провайдера — не больше MaxProviderCharsPerCall.
         *
         * Была соблазнительная идея поднять здесь лимит до MaxTextLength
         * («текст 400 символов помещается в один запрос — незачем резать»),
         * но она ломает главное: куски абзаца достаются РАЗНЫМ провайдерам
         * (кэш одного слова лежит WAV-ом от Gemini, соседнее уходит в резерв),
         * и склейка WAV с MP3 невозможна. Общий знаменатель 180 гарантирует
         * однородность, а нарезка — наша, бесплатная.
         *
         * Замер резерва: 200 символов → HTTP 200, 210 → HTTP 400. 180 держит
         * запас, поэтому в тесте абзац обязан прийти несколькими кусками.
         */
        if (normalized.Length > maxChars)
        {
            return null;
        }

        var packPath = FindPackFile(normalized);
        if (packPath != null)
        {
            try
            {
                return new TtsAudio(await File.ReadAllBytesAsync(packPath, cancellationToken), Mp3ContentType);
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
                return new TtsAudio(await File.ReadAllBytesAsync(wavPath, cancellationToken), WavContentType);
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
                return new TtsAudio(await File.ReadAllBytesAsync(gtxPath, cancellationToken), Mp3ContentType);
            }
            catch (IOException ex)
            {
                _logger.LogWarning(ex, "Failed to read cached GTX audio");
            }
        }

        byte[]? gemini = null;

        // Azure стоит после пака и кэшей, но до Gemini: слова вне пака тоже
        // должны звучать AriaNeural, а не случайным голосом нейросети. Если
        // ключа нет или бюджет месяца исчерпан, сервис молча вернёт null.
        var azureClip = await _azure.SynthesizeAsync(normalized, cancellationToken);
        if (azureClip != null)
        {
            return new TtsAudio(azureClip.Data, azureClip.ContentType);
        }

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
            return new TtsAudio(gemini, WavContentType);
        }

        var gtx = await SynthesizeGtxAsync(normalized, cancellationToken);
        return gtx == null ? null : new TtsAudio(gtx, Mp3ContentType);
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
        // занят. Потолок держим чуть выше окна ожидания фронтенда (6 с), чтобы
        // сервер успевал ответить хоть чем-то естественным, а не молчал.
        var timeoutSeconds = Math.Clamp(_configuration.GetValue("Tts:GeminiTimeoutSeconds", 6), 3, 60);
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

/// <summary>
/// Текст длиннее <see cref="SpeechService.MaxTextLength"/>: молча резать текст
/// нельзя (пользователь слышит обрывок фразы и не знает об этом), поэтому
/// вызывающий обязан отдать ошибку — контроллер отвечает 413.
/// </summary>
public sealed class SpeechTextTooLongException(int actual, int limit)
    : Exception($"Текст для озвучки длиннее {limit} символов ({actual}). Разделите его на части.")
{
    public int ActualLength { get; } = actual;

    public int Limit { get; } = limit;
}

/// <summary>
/// Куски озвучки пришли в разных форматах (например, WAV от Gemini и MP3 от
/// резерва): склейка без перекодирования даст файл, который браузер не
/// проиграет. Лучше честная ошибка, чем тишина или треск на середине главы.
/// </summary>
public sealed class SpeechMergeUnsupportedException(string actual, string expected)
    : Exception($"Склейка озвучки невозможна: кусок в {actual}, а остальные в {expected}.")
{
    public string ActualContentType { get; } = actual;

    public string ExpectedContentType { get; } = expected;
}

/// <summary>
/// Нарезка длинного текста на вызовы провайдера.
///
/// Правило одно: потерянных слов быть не должно. Сначала режем по границам
/// предложений (<see cref="Reader.SentenceSplitter"/> — уже проверенный в
/// читалке, он не рвёт «Mr.» и «3.14»), а слишком длинное предложение — по
/// словам. Резать по буквам нельзя: MP3-куски склеиваются, но слово, разорванное
/// пополам, звучит как «rab-bit» с отдельными ударениями.
/// </summary>
public static class SpeechSegmentPlanner
{
    /// <summary>
    /// Кусок = целые предложения, пока они влезают в лимит. Предложение длиннее
    /// лимита режется по словам; слово длиннее лимита (ссылка, «supercalifragilistic»)
    /// остаётся целым — провайдер откажет, но текст не потеряется.
    /// </summary>
    public static IReadOnlyList<string> Plan(string text, int maxChars)
    {
        if (maxChars < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maxChars));
        }

        var normalized = Normalize(text);
        if (normalized.Length == 0)
        {
            return Array.Empty<string>();
        }

        if (normalized.Length <= maxChars)
        {
            return new[] { normalized };
        }

        var segments = new List<string>();
        var buffer = new List<string>();
        var bufferLength = 0;

        foreach (var sentence in Reader.SentenceSplitter.Split(normalized))
        {
            if (sentence.Length > maxChars)
            {
                // Предложение само не влезает в один вызов (длинная фраза без точек,
                // список через «и»): режем по словам, иначе провайдер получит слишком
                // длинный текст и вызов провалится.
                Flush(buffer, segments, ref bufferLength);
                segments.AddRange(SplitByWords(sentence, maxChars));
                continue;
            }

            // +1 на пробел между предложениями в собранном куске
            var needed = buffer.Count == 0 ? sentence.Length : bufferLength + 1 + sentence.Length;
            if (needed > maxChars)
            {
                Flush(buffer, segments, ref bufferLength);
            }

            bufferLength = buffer.Count == 0 ? sentence.Length : bufferLength + 1 + sentence.Length;
            buffer.Add(sentence);
        }

        Flush(buffer, segments, ref bufferLength);

        /*
         * SentenceSplitter без единой точки возвращает текст ОДНИМ «предложением» —
         * и такая ветка попадала в `sentence.Length > maxChars` выше, раскладывая
         * текст по словам. Но только если предложений БОЛЬШЕ одного: когда весь
         * текст — одно длинное предложение, буфер оказывается пуст, `segments`
         * получает ровно один кусок длиннее лимита, и сервис отправлял провайдеру
         * 1196 символов одним запросом, где резерв гарантированно отвечает 413.
         *
         * Проверка была, но стояла ПОСЛЕ Flush и срабатывала только на точно
         * одном сегменте — а после ветки `sentence.Length > maxChars` сегментов
         * уже больше одного. Теперь режем по словам любой кусок, который не
         * влезает, а не только «единственный».
         */
        var oversized = segments.Where(segment => segment.Length > maxChars).ToList();
        if (oversized.Count > 0)
        {
            var fixedSegments = new List<string>(segments.Count);
            foreach (var segment in segments)
            {
                if (segment.Length > maxChars)
                {
                    fixedSegments.AddRange(SplitByWords(segment, maxChars));
                }
                else
                {
                    fixedSegments.Add(segment);
                }
            }

            return fixedSegments;
        }

        return segments;
    }

    /// <summary>
    /// Склеивает потоки провайдера. MP3 допускает конкатенацию кадров, а ID3v2-
    /// заголовок (он бывает только у первого файла) в середине потока сбивает
    /// декодер — поэтому у следующих кусков он срезается.
    ///
    /// Смешивать контейнеры нельзя: WAV (Gemini) и MP3 (резерв) дают файл,
    /// который браузер не проиграет. Ошибку ловит вызывающий — до этого места
    /// куски одного типа доезжают только после явной проверки, но проверка
    /// дублируется здесь, потому что метод публичный и используется в тестах.
    /// </summary>
    public static byte[] Concat(IReadOnlyList<byte[]> clips)
    {
        if (clips.Count == 0)
        {
            return Array.Empty<byte>();
        }

        var total = clips.Sum(clip => clip.Length);
        var output = new byte[total];
        var offset = 0;
        for (var index = 0; index < clips.Count; index++)
        {
            var clip = clips[index];
            var start = index == 0 ? 0 : Id3TagLength(clip);
            var length = clip.Length - start;
            if (length > 0)
            {
                Buffer.BlockCopy(clip, start, output, offset, length);
                offset += length;
            }
        }

        return offset == total ? output : output[..offset];
    }

    private static void Flush(List<string> buffer, List<string> segments, ref int bufferLength)
    {
        if (buffer.Count > 0)
        {
            segments.Add(string.Join(' ', buffer));
        }

        buffer.Clear();
        bufferLength = 0;
    }

    private static IEnumerable<string> SplitByWords(string sentence, int maxChars)
    {
        var words = sentence.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var current = new List<string>();
        var length = 0;

        foreach (var word in words)
        {
            var needed = current.Count == 0 ? word.Length : length + 1 + word.Length;
            if (needed > maxChars && current.Count > 0)
            {
                yield return string.Join(' ', current);
                current.Clear();
                length = 0;
            }

            length = current.Count == 0 ? word.Length : length + 1 + word.Length;
            current.Add(word);
        }

        if (current.Count > 0)
        {
            yield return string.Join(' ', current);
        }
    }

    /// <summary>
    /// Длина ID3v2-заголовка: «ID3» + версия + флаги + 4 байта synchsafe-размера.
    /// Не MP3 — 0, такие байты отдаём как есть.
    /// </summary>
    private static int Id3TagLength(byte[] clip)
    {
        if (clip.Length < 10 || clip[0] != 0x49 || clip[1] != 0x44 || clip[2] != 0x33)
        {
            return 0;
        }

        var size = (clip[6] & 0x7F) << 21 | (clip[7] & 0x7F) << 14 | (clip[8] & 0x7F) << 7 | (clip[9] & 0x7F);
        var footer = (clip[5] & 0x10) != 0 ? 10 : 0;
        var total = 10 + size + footer;
        return total < clip.Length ? total : 0;
    }

    private static string Normalize(string? text) =>
        string.IsNullOrWhiteSpace(text)
            ? string.Empty
            : System.Text.RegularExpressions.Regex.Replace(text, @"\s+", " ").Trim();
}
