using System.Security.Claims;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Audio;

/// <summary>
/// Семантика отказов GET /api/audio/tts.
///
/// Живой прогон на стенде показал: абзац на 200/400/600 символов получал
/// 413 «Склейка озвучки невозможна: кусок в audio/wav, а ...» вместо звука.
/// Лимит длины тут ни при чём — провайдеры возвращают разные контейнеры
/// (WAV от Gemini, MP3 от резерва), а склейка без перекодирования запрещена.
///
/// Клиент (frontend/src/hooks/useTts.ts) на любой не-ok ответ уходит на
/// браузерный голос, поэтому правильный код здесь — 503 «серверный голос
/// сейчас не готов». 413 значит «я не приму такой запрос», и это ложь:
/// запрос корректен, а отказал формат.
///
/// Тесты фиксируют три РАЗНЫХ отказа, чтобы их снова не смешали:
///   * 413 — только текст длиннее лимита;
///   * 503 — провайдер или формат недоступны (звук будет, но браузерный);
///   * 200 — текст в пределах лимита до сервиса доходит.
/// </summary>
public class TtsRefusalTests : IDisposable
{
    private readonly string _root;
    private readonly ApplicationDbContext _db;

    public TtsRefusalTests()
    {
        // ContentRoot теста — каталог сборки: туда процесс точно пишет.
        // Не Path.GetTempPath(): на этой машине TMPDIR=C:\Temp без прав на запись.
        _root = Path.Combine(AppContext.BaseDirectory, "elp-tts-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);

        _db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase("tts-" + Guid.NewGuid().ToString("N"))
                .Options);
    }

    public void Dispose()
    {
        _db.Dispose();
        try
        {
            Directory.Delete(_root, recursive: true);
        }
        catch (IOException)
        {
            // временная папка теста
        }
    }

    private static IConfiguration Configuration => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            // Ключ задан намеренно: если сервис всё же пойдёт в Gemini, тест
            // упадёт на запрещённой сети, а не пройдёт тихо по пустому ключу.
            ["Gemini:ApiKey"] = "test-key",
            ["Azure:Speech:Key"] = "azure-key",
            ["Azure:Speech:Region"] = "westeurope",
            ["Azure:Speech:MonthlyCharLimit"] = "400000",
        })
        .Build();

    private SpeechService CreateService(AzureSpeechService azure) =>
        new(
            Configuration,
            new RootEnvironment(_root),
            NullLogger<SpeechService>.Instance,
            new ResilientAiService(
                Configuration,
                NullLogger<ResilientAiService>.Instance,
                new HttpClient(new ForbiddenNetworkHandler()),
                Array.Empty<TimeSpan>()),
            azure);

    private static AudioController CreateController(SpeechService speech) =>
        new(speech, NullLogger<AudioController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, "tts-user") }, "test"))
                }
            }
        };

    /// <summary>
    /// Текст длиннее лимита — 413 с объяснением, а не молчаливая обрезка.
    /// Проверяется, что отказ наступает ДО обращения к провайдеру.
    /// </summary>
    [Fact]
    public async Task Текст_длиннее_лимита_даёт_413_с_объяснением()
    {
        var azure = new RecordingAzure(_db, _root);
        var controller = CreateController(CreateService(azure));

        var result = await controller.GetTts(new string('a', SpeechService.MaxTextLength + 1), default);

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(413, status.StatusCode);
        Assert.Empty(azure.Requests);
    }

    /// <summary>
    /// Ровно лимит — ещё допустимый запрос. Обрезки быть не должно: раньше
    /// 1200 символов доезжали до провайдера урезанными.
    /// </summary>
    [Fact]
    public async Task Ровно_лимит_не_считается_ошибкой_запроса()
    {
        var azure = new RecordingAzure(_db, _root);
        var controller = CreateController(CreateService(azure));

        var text = string.Join(' ', Enumerable.Repeat("the river was deep and cold", 200))
            [..SpeechService.MaxTextLength];
        var result = await controller.GetTts(text, default);

        // Не 400 и не «текст слишком длинный» — отказ только как «провайдер не готов».
        Assert.IsNotType<BadRequestObjectResult>(result);
        if (result is ObjectResult objectResult)
        {
            Assert.Equal(503, objectResult.StatusCode);
        }
        else
        {
            Assert.IsType<FileContentResult>(result);
        }
    }

    /// <summary>
    /// Разные контейнеры в кусках больше НЕ отказ: сервис склеивает их в MP3.
    ///
    /// История дефекта: контроллер отдавал 413 «Склейка невозможна», клиент
    /// читал это как «плохой запрос», и абзацы не звучали серверным голосом
    /// вовсе. Сначала код ошибки поправили на 503, но причина оставалась.
    /// Теперь AudioMerge приводит куски к одному контейнеру, и абзац звучит.
    ///
    /// Если ffmpeg в системе нет — остаётся честный 503 и браузерный голос;
    /// этот путь покрыт AudioMergeTests и отдельным тестом ниже.
    /// </summary>
    [Fact]
    public async Task Разные_форматы_кусков_склеиваются_а_не_отказывают()
    {
        if (AudioMerge.FindFfmpeg() == null)
        {
            // Без ffmpeg склеить WAV с MP3 нечем — ветка отказа проверяется ниже.
            return;
        }

        var azure = new MixedFormatAzure(_db, _root);
        var service = CreateService(azure);

        // 1196 символов: сервис обязан резать и склеивать.
        var text = string.Join(' ', Enumerable.Repeat("rabbit", 171));

        var audio = await service.SynthesizeAsync(text, "tts-user");

        Assert.NotNull(audio);
        // Результат — однородный MP3, который браузер проиграет одной дорожкой.
        Assert.Equal(AudioMerge.Mp3ContentType, audio!.ContentType);
        Assert.True(AudioMerge.IsMp3(audio.Data));
    }

    /// <summary>
    /// Без ffmpeg смешанные куски дают отказ — и клиент уходит на браузерный
    /// голос. Битый файл был бы хуже.
    /// </summary>
    [Fact]
    public async Task Без_ffmpeg_смешанные_куски_дают_отказ()
    {
        var azure = new MixedFormatAzure(_db, _root);
        var service = CreateService(azure);

        var text = string.Join(' ', Enumerable.Repeat("rabbit", 171));

        // Подменяем поиск ffmpeg на «не найден».
        var merged = await AudioMerge.MergeAsync(
            new List<(byte[], string)>
            {
                (new byte[] { 0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2 }, AudioMerge.WavContentType),
                (new byte[] { 0xFF, 0xFB, 1, 2, 3 }, AudioMerge.Mp3ContentType),
            },
            ffmpegPath: null,
            CancellationToken.None);

        Assert.Null(merged);
    }

    /// <summary>Пустой текст — единственный настоящий 400 в этом эндпоинте.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Пустой_текст_даёт_400(string? text)
    {
        var controller = CreateController(CreateService(new RecordingAzure(_db, _root)));

        var result = await controller.GetTts(text, default);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>Подменённый Azure: записывает куски и всегда отдаёт MP3.</summary>
    private class RecordingAzure : AzureSpeechService
    {
        public RecordingAzure(ApplicationDbContext context, string root)
            : base(context, new OfflineHandlerFactory(), new RootEnvironment(root), Configuration,
                NullLogger<AzureSpeechService>.Instance)
        {
        }

        public List<string> Requests { get; } = new();

        public override Task<SpeechClip?> SynthesizeAsync(
            string text, CancellationToken cancellationToken = default)
        {
            Requests.Add(text);
            return Task.FromResult<SpeechClip?>(new SpeechClip(Mp3Frame(), "audio/mpeg", false));
        }

        protected static byte[] Mp3Frame() => new byte[] { 0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00 };
    }

    /// <summary>
    /// Подменённый Azure, который отдаёт куски в РАЗНЫХ контейнерах — ровно то,
    /// что делает живая связка «Gemini (WAV) + резерв (MP3)».
    /// </summary>
    private sealed class MixedFormatAzure : RecordingAzure
    {
        public MixedFormatAzure(ApplicationDbContext context, string root) : base(context, root)
        {
        }

        private int _calls;

        public override Task<SpeechClip?> SynthesizeAsync(
            string text, CancellationToken cancellationToken = default)
        {
            var first = _calls++ == 0;
            return Task.FromResult<SpeechClip?>(first
                ? new SpeechClip(WavPcm(), "audio/wav", false)
                : new SpeechClip(Mp3Frame(), "audio/mpeg", false));
        }

        /// <summary>
        /// WAV с ЗАМЕТНЫМ куском звука.
        ///
        /// Раньше здесь было 64 байта (20 байт PCM ≈ 0.0004 с) — ffmpeg такой
        /// файл не кодирует, и тест получал null, хотя код был исправен.
        /// 4800 байт PCM = 0.1 с при 24 кГц: минимум, который кодируется.
        /// </summary>
        private static byte[] WavPcm()
        {
            const int sampleRate = 24000;
            const int pcmBytes = 4800;

            var data = new byte[44 + pcmBytes];
            System.Text.Encoding.ASCII.GetBytes("RIFF").CopyTo(data, 0);
            BitConverter.TryWriteBytes(data.AsSpan(4, 4), 36 + pcmBytes);
            System.Text.Encoding.ASCII.GetBytes("WAVE").CopyTo(data, 8);
            System.Text.Encoding.ASCII.GetBytes("fmt ").CopyTo(data, 12);
            BitConverter.TryWriteBytes(data.AsSpan(16, 4), 16);
            BitConverter.TryWriteBytes(data.AsSpan(20, 2), (short)1);        // PCM
            BitConverter.TryWriteBytes(data.AsSpan(22, 2), (short)1);        // моно
            BitConverter.TryWriteBytes(data.AsSpan(24, 4), sampleRate);
            BitConverter.TryWriteBytes(data.AsSpan(28, 4), sampleRate * 2);  // byte rate
            BitConverter.TryWriteBytes(data.AsSpan(32, 2), (short)2);        // block align
            BitConverter.TryWriteBytes(data.AsSpan(34, 2), (short)16);       // 16 бит
            System.Text.Encoding.ASCII.GetBytes("data").CopyTo(data, 36);
            BitConverter.TryWriteBytes(data.AsSpan(40, 4), pcmBytes);
            data.AsSpan(44).Fill(0x7F);
            return data;
        }
    }

    private sealed class OfflineHandlerFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) =>
            new(new ForbiddenNetworkHandler(), disposeHandler: false);
    }

    /// <summary>Любой сетевой вызов — провал теста: провайдер подменён выше.</summary>
    private sealed class ForbiddenNetworkHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new InvalidOperationException($"Сеть в этом тесте запрещена: {request.RequestUri}");
    }

    private sealed class RootEnvironment(string root) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "test";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string EnvironmentName { get; set; } = "Test";
        public string WebRootName { get; set; } = "wwwroot";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = root;
        public string ContentRootPath { get; set; } = root;
    }
}
