using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services.Reader;

/// <summary>
/// Озвучка глав через официальный Azure Speech. Edge-TTS с сервера уже
/// проверен и отвечает 403, поэтому единственный законный путь к тому же
/// голосу AriaNeural — REST-синтез с ключом, который живёт только на сервере.
///
/// Кэш на диске общий для всех читателей: одна и та же фраза «Моби Дика»
/// синтезируется один раз. Счётчик символов — защита от счёта, а не
/// оптимизация: при исчерпании месячного лимита Azure не вызывается вовсе,
/// а клиент тихо уходит на голос браузера.
/// </summary>
/// <remarks>
/// Не sealed: тест R7 подменяет провайдера наследником, чтобы посчитать, какие
/// куски текста и сколько раз реально ушли в сеть. Продовый код наследников не заводит.
/// </remarks>
public class AzureSpeechService
{
    public const string DefaultVoice = "en-US-AriaNeural";
    public const int DefaultMonthlyCharLimit = 400_000;
    public const int MaxCharsPerRequest = 2_000;

    private const string OutputFormat = "audio-24khz-48kbitrate-mono-mp3";
    private const string Rate = "-10%";

    /// <summary>После 429 или отказа квоты не дёргаем Azure десять минут.</summary>
    private static readonly TimeSpan ProviderCooldown = TimeSpan.FromMinutes(10);

    private static readonly SemaphoreSlim BudgetGate = new(1, 1);
    private static DateTime _retryAfterUtc = DateTime.MinValue;
    private static int _cooldownLogged;

    private readonly ApplicationDbContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<AzureSpeechService> _logger;
    private readonly string? _key;
    private readonly string? _region;
    private readonly int _monthlyCharLimit;

    public AzureSpeechService(
        ApplicationDbContext context,
        IHttpClientFactory httpClientFactory,
        IWebHostEnvironment environment,
        IConfiguration configuration,
        ILogger<AzureSpeechService> logger)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _environment = environment;
        _logger = logger;

        _key = configuration["Azure:Speech:Key"];
        _region = configuration["Azure:Speech:Region"];
        Voice = configuration["Azure:Speech:Voice"] is { Length: > 0 } voice ? voice : DefaultVoice;
        _monthlyCharLimit = Math.Max(
            1_000,
            configuration.GetValue("Azure:Speech:MonthlyCharLimit", DefaultMonthlyCharLimit));
    }

    public string Voice { get; }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_key) && !string.IsNullOrWhiteSpace(_region);

    public string CacheDirectory =>
        Path.Combine(_environment.ContentRootPath, "uploads", "tts-azure");

    public sealed record SpeechClip(byte[] Data, string ContentType, bool FromCache);

    /// <summary>
    /// Имя кэша зависит только от голоса, темпа и текста: один и тот же
    /// абзац у двух читателей даёт один файл и один расход символов.
    /// </summary>
    public string CacheName(string text)
    {
        var payload = $"{Voice}|{Rate}|{text}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)))
            .ToLowerInvariant() + ".mp3";
    }

    public string? GetCachedPath(string name)
    {
        if (!IsCacheName(name))
        {
            return null;
        }

        var path = Path.Combine(CacheDirectory, name);
        return File.Exists(path) ? path : null;
    }

    public static bool IsCacheName(string name) =>
        name.Length == 68 &&
        name.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) &&
        name[..64].All(Uri.IsHexDigit);

    /// <summary>
    /// Сколько символов спишется за этот текст. Нужно тому, кто планирует расход
    /// до вызова (прогрев главы): считать по исходному тексту нельзя — нормализация
    /// схлопывает пробелы, и смета разошлась бы со счётом.
    /// </summary>
    public static int MeasureChars(string? text) => Normalize(text).Length;

    /// <summary>
    /// Виртуальный ради теста R7: внешнего провайдера нельзя подсунуть иначе, а
    /// проверять надо именно то, как <see cref="SpeechService"/> режет и склеивает
    /// куски. Продовый код метод не переопределяет.
    /// </summary>
    public virtual async Task<SpeechClip?> SynthesizeAsync(string text, CancellationToken cancellationToken = default)
    {
        var normalized = Normalize(text);
        if (normalized.Length == 0)
        {
            return null;
        }

        // Обрезка до MaxCharsPerRequest убрана: в главе такое предложение
        // встречается (длинная цитата без точек) и теряло конец. Кто зовёт нас
        // без нарезки — сам отвечает за формат, а мы лучше промолчим, чем
        // озвучим половину. Читалка режет предложения сама (см. ChapterSpeechPrefetcher).
        if (normalized.Length > MaxCharsPerRequest)
        {
            _logger.LogWarning(
                "Azure TTS: текст {Length} символов длиннее запроса {Limit}, кусок пропущен",
                normalized.Length, MaxCharsPerRequest);
            return null;
        }

        if (normalized.Length > _monthlyCharLimit)
        {
            return null;
        }

        var name = CacheName(normalized);
        var cached = GetCachedPath(name);
        if (cached != null)
        {
            try
            {
                return new SpeechClip(await File.ReadAllBytesAsync(cached, cancellationToken), "audio/mpeg", true);
            }
            catch (IOException ex)
            {
                _logger.LogWarning(ex, "Azure TTS: кэш занят, синтезирую заново");
            }
        }

        if (!IsConfigured)
        {
            return null;
        }

        if (DateTime.UtcNow < _retryAfterUtc)
        {
            return null;
        }

        // Символы резервируем до запроса: иначе при лимите 400 000 и сорока
        // одновременных главах счётчик перескочит потолок и владелец получит счёт.
        var reserved = await ReserveCharsAsync(normalized.Length, cancellationToken);
        if (!reserved)
        {
            _logger.LogInformation("Azure TTS: месячный лимит символов исчерпан, отдаю браузерный голос");
            return null;
        }

        try
        {
            var audio = await RequestAsync(normalized, cancellationToken);
            if (audio == null)
            {
                await ReleaseCharsAsync(normalized.Length, cancellationToken);
                return null;
            }

            Directory.CreateDirectory(CacheDirectory);
            var path = Path.Combine(CacheDirectory, name);
            try
            {
                // Пишем через временный файл: читатель может запросить ту же
                // фразу, пока первый запрос ещё дописывает файл.
                var temp = path + ".tmp";
                await File.WriteAllBytesAsync(temp, audio, cancellationToken);
                File.Move(temp, path, overwrite: true);
            }
            catch (IOException ex)
            {
                _logger.LogWarning(ex, "Azure TTS: не удалось сохранить кэш {Name}", name);
            }

            return new SpeechClip(audio, "audio/mpeg", false);
        }
        catch (AzureSpeechUnavailableException ex)
        {
            await ReleaseCharsAsync(normalized.Length, cancellationToken);
            _logger.LogWarning("Azure TTS недоступен: {Reason}", ex.Message);
            return null;
        }
    }

    private async Task<byte[]?> RequestAsync(string text, CancellationToken cancellationToken)
    {
        var client = _httpClientFactory.CreateClient("azure-speech");
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://{_region}.tts.speech.microsoft.com/cognitiveservices/v1");

        request.Headers.Add("Ocp-Apim-Subscription-Key", _key);
        request.Headers.UserAgent.ParseAdd("EnglishLearningPlatform/3.0");
        request.Content = new StringContent(BuildSsml(text), Encoding.UTF8);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/ssml+xml");
        request.Headers.Add("X-Microsoft-OutputFormat", OutputFormat);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));

        using var response = await client.SendAsync(request, timeout.Token);
        if (response.IsSuccessStatusCode)
        {
            Interlocked.Exchange(ref _cooldownLogged, 0);
            return await response.Content.ReadAsByteArrayAsync(timeout.Token);
        }

        if (response.StatusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        {
            _retryAfterUtc = DateTime.UtcNow + ProviderCooldown;
            if (Interlocked.CompareExchange(ref _cooldownLogged, 1, 0) == 0)
            {
                _logger.LogWarning(
                    "Azure TTS ответил {Status}; до {Until:HH:mm} UTC озвучиваю голосом браузера",
                    (int)response.StatusCode,
                    _retryAfterUtc);
            }

            return null;
        }

        throw new AzureSpeechUnavailableException($"HTTP {(int)response.StatusCode}");
    }

    /// <summary>SSML собирается здесь, а не на клиенте: текст книги — не доверенный XML.</summary>
    public string BuildSsml(string text)
    {
        var settings = new XmlWriterSettings { OmitXmlDeclaration = true, Indent = false };
        using var output = new StringWriter();
        using (var writer = XmlWriter.Create(output, settings))
        {
            // Пространство имён задаёт сам writer: ручной xmlns-атрибут
            // конфликтует с ним и роняет сборку SSML.
            writer.WriteStartElement("speak", "http://www.w3.org/2001/10/synthesis");
            writer.WriteAttributeString("version", "1.0");
            writer.WriteAttributeString("xml", "lang", null, "en-US");

            writer.WriteStartElement("voice");
            writer.WriteAttributeString("name", Voice);

            writer.WriteStartElement("prosody");
            writer.WriteAttributeString("rate", Rate);
            writer.WriteString(text);
            writer.WriteEndElement();

            writer.WriteEndElement();
            writer.WriteEndElement();
        }

        return output.ToString();
    }

    /// <summary>
    /// Атомарно занимает символы в месячном счётчике. false — бюджет уже
    /// исчерпан, Azure вызывать нельзя. В PostgreSQL это один INSERT ... ON
    /// CONFLICT с условием, поэтому гонка двух глав не превышает лимит.
    /// </summary>
    private async Task<bool> ReserveCharsAsync(int chars, CancellationToken cancellationToken)
    {
        var period = DateTime.UtcNow.ToString("yyyy-MM");

        if (_context.Database.IsNpgsql())
        {
            var affected = await _context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 INSERT INTO "SpeechUsages" ("Period", "Chars", "UpdatedAt")
                 VALUES ({period}, {chars}, now())
                 ON CONFLICT ("Period") DO UPDATE
                 SET "Chars" = "SpeechUsages"."Chars" + {chars}, "UpdatedAt" = now()
                 WHERE "SpeechUsages"."Chars" + {chars} <= {_monthlyCharLimit}
                 """,
                cancellationToken);

            return affected > 0;
        }

        // InMemory/SQLite в тестах: тот же контракт, но под процессной блокировкой.
        await BudgetGate.WaitAsync(cancellationToken);
        try
        {
            var usage = await _context.SpeechUsages
                .FirstOrDefaultAsync(u => u.Period == period, cancellationToken);
            if (usage == null)
            {
                usage = new SpeechUsage { Period = period, Chars = 0 };
                _context.SpeechUsages.Add(usage);
            }

            if (usage.Chars + chars > _monthlyCharLimit)
            {
                return false;
            }

            usage.Chars += chars;
            usage.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync(cancellationToken);
            return true;
        }
        finally
        {
            BudgetGate.Release();
        }
    }

    private async Task ReleaseCharsAsync(int chars, CancellationToken cancellationToken)
    {
        var period = DateTime.UtcNow.ToString("yyyy-MM");

        if (_context.Database.IsNpgsql())
        {
            await _context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE "SpeechUsages"
                 SET "Chars" = GREATEST(0, "Chars" - {chars}), "UpdatedAt" = now()
                 WHERE "Period" = {period}
                 """,
                cancellationToken);
            return;
        }

        await BudgetGate.WaitAsync(cancellationToken);
        try
        {
            var usage = await _context.SpeechUsages
                .FirstOrDefaultAsync(u => u.Period == period, cancellationToken);
            if (usage != null)
            {
                usage.Chars = Math.Max(0, usage.Chars - chars);
                usage.UpdatedAt = DateTime.UtcNow;
                await _context.SaveChangesAsync(cancellationToken);
            }
        }
        finally
        {
            BudgetGate.Release();
        }
    }

    public async Task<long> GetUsedCharsAsync(CancellationToken cancellationToken = default)
    {
        var period = DateTime.UtcNow.ToString("yyyy-MM");
        return await _context.SpeechUsages.AsNoTracking()
            .Where(u => u.Period == period)
            .Select(u => u.Chars)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public long MonthlyCharLimit => _monthlyCharLimit;

    private static string Normalize(string? text) =>
        string.IsNullOrWhiteSpace(text)
            ? string.Empty
            : System.Text.RegularExpressions.Regex.Replace(text, @"\s+", " ").Trim();

    private sealed class AzureSpeechUnavailableException(string message) : Exception(message);
}
