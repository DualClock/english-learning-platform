using System.Net;
using System.Text;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// Пак озвучки вместо квоты (R6).
///
/// Продукт платит за TTS дважды: деньгами (Azure — 400 000 символов в месяц на
/// весь сервис, Gemini — 100 запросов в сутки) и задержкой (3–6 с на слово, из-за
/// чего фронтенд вообще уходит на голос браузера). Пак из 4500 файлов снимает оба
/// платежа, но только пока <see cref="SpeechService"/> смотрит в пак ПЕРВЫМ.
///
/// Поэтому здесь проверяется не «файл нашёлся», а главное: при наличии файла ни
/// Azure, ни Gemini не вызываются. Моки провайдеров бросают исключение, если к ним
/// пришли — тест падает на любом регрессе порядка.
/// </summary>
public class SpeechPackTests : IDisposable
{
    private readonly string _root;

    public SpeechPackTests()
    {
        _root = Path.Combine(AppContext.BaseDirectory, "elp-pack-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(_root, recursive: true);
        }
        catch (IOException)
        {
            // временная папка теста, чистить её не обязательно
        }
    }

    /// <summary>
    /// Имя файла внутри пака ровно то, что считает generate.py:
    /// sha256("pack|" + слово в нижнем регистре). Считается здесь независимо,
    /// чтобы смена формата на любой из сторон ломала тест, а не прод.
    /// </summary>
    private static string PackFileName(string word)
    {
        var key = "pack|" + string.Join(' ', word.Trim().Split(
            (char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();
        var hash = Convert.ToHexString(
            System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();
        return hash + ".mp3";
    }

    private string PackDirectory => Path.Combine(_root, "uploads", "tts-pack");

    private SpeechService CreateService(HttpMessageHandler geminiHandler)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                // Ключ задан намеренно: иначе Gemini не вызывается и тест
                // «HTTP не было» проходил бы по неправильной причине.
                ["Gemini:ApiKey"] = "test-key",
                ["Ai:TimeoutSeconds"] = "5",
                ["Ai:MaxRetries"] = "1",
                // Пустой регион: Azure считается ненастроенным и в сеть не идёт.
                ["Azure:Speech:Key"] = null,
                ["Azure:Speech:Region"] = null,
            })
            .Build();

        var resilient = new ResilientAiService(
            configuration,
            NullLogger<ResilientAiService>.Instance,
            new HttpClient(geminiHandler),
            Array.Empty<TimeSpan>());

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("pack-" + Guid.NewGuid().ToString("N"))
            .Options;
        var db = new ApplicationDbContext(options);

        var azure = new AzureSpeechService(
            db,
            new SingleHandlerFactory(geminiHandler),
            new RootEnvironment(_root),
            configuration,
            NullLogger<AzureSpeechService>.Instance);

        return new SpeechService(
            configuration,
            new RootEnvironment(_root),
            NullLogger<SpeechService>.Instance,
            resilient,
            azure);
    }

    private string WritePackFile(string word, string suffix)
    {
        Directory.CreateDirectory(PackDirectory);
        var path = Path.Combine(PackDirectory, PackFileName(word));
        File.WriteAllBytes(path, Encoding.UTF8.GetBytes("PACK:" + suffix));
        return path;
    }

    [Fact]
    public async Task Файл_пака_отдаётся_и_провайдер_не_вызывается()
    {
        var word = "rabbit";
        var packed = WritePackFile(word, "AriaNeural");

        var handler = new ThrowingHandler();
        var service = CreateService(handler);

        var audio = await service.SynthesizeAsync(word, userId: "user-1");

        Assert.NotNull(audio);
        Assert.Equal("audio/mpeg", audio!.ContentType);
        Assert.Equal(File.ReadAllBytes(packed), audio.Data);
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task Пак_даже_при_пустом_бюджете_Azure_и_истёкшей_квоте_Gemini()
    {
        // Ключей нет вовсе — то есть день живёт на голосе браузера. Пак должен
        // отдать нейроголос не менее охотно, чем при полном бюджете.
        var packed = WritePackFile("tea", "AriaNeural");

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();
        var handler = new ThrowingHandler();
        var resilient = new ResilientAiService(
            configuration, NullLogger<ResilientAiService>.Instance,
            new HttpClient(handler), Array.Empty<TimeSpan>());
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase("pack-empty-" + Guid.NewGuid().ToString("N"))
                .Options);

        var service = new SpeechService(
            configuration,
            new RootEnvironment(_root),
            NullLogger<SpeechService>.Instance,
            resilient,
            new AzureSpeechService(
                db, new SingleHandlerFactory(handler), new RootEnvironment(_root),
                configuration, NullLogger<AzureSpeechService>.Instance));

        var audio = await service.SynthesizeAsync("tea", userId: null);

        Assert.NotNull(audio);
        Assert.Equal(File.ReadAllBytes(packed), audio!.Data);
    }

    [Fact]
    public async Task Без_файла_пака_запрос_уходит_провайдеру()
    {
        // Контроль обратной стороны: тот же сервис, тот же запрос, но пака нет.
        // Если бы тест выше проходил из-за того, что синтез вообще не работает,
        // здесь бы не было ни вызова, ни аудио.
        var handler = new CountingHandler();
        var service = CreateService(handler);

        var audio = await service.SynthesizeAsync("cheshire", userId: "user-1");

        Assert.True(handler.Calls > 0, "без пака озвучка обязана идти к провайдеру");
        Assert.NotNull(audio);
    }

    [Fact]
    public void Имя_файла_пака_детерминировано_и_не_зависит_от_регистра()
    {
        // В книге «Alice», в словаре «alice» — файл должен быть один.
        Assert.Equal(PackFileName("alice"), PackFileName("Alice"));
        Assert.Equal(PackFileName("white  rabbit"), PackFileName("White Rabbit"));
        Assert.Equal(PackFileName("rabbit"), PackFileName(" rabbit "));

        // 64 hex + ".mp3", как и ждёт FindPackFile
        var name = PackFileName("rabbit");
        Assert.Equal(68, name.Length);
        Assert.EndsWith(".mp3", name);
        Assert.Equal(name.ToLowerInvariant(), name);
    }

    [Fact]
    public async Task Файл_пака_с_регистром_из_книги_находится()
    {
        // Кладём «как из книги» — с заглавной буквы. Пака-хэш в нижнем регистре,
        // поэтому сервер обязан искать второй кандидат.
        var name = PackFileName("Alice");
        Directory.CreateDirectory(PackDirectory);
        File.WriteAllBytes(Path.Combine(PackDirectory, name), Encoding.UTF8.GetBytes("PACK:Alice"));

        var handler = new ThrowingHandler();
        var service = CreateService(handler);

        var audio = await service.SynthesizeAsync("Alice", userId: "user-1");

        Assert.NotNull(audio);
        Assert.Equal(0, handler.Calls);
    }

    private sealed class SingleHandlerFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
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

    /// <summary>Любой сетевой вызов — провал теста: пак должен был ответить сам.</summary>
    private sealed class ThrowingHandler : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            throw new InvalidOperationException(
                $"Сеть в этом тесте запрещена, а был запрос на {request.RequestUri}");
        }
    }

    /// <summary>Считает вызовы и отдаёт JSON без аудио — нам важно только, что сходили.</summary>
    private sealed class CountingHandler : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"candidates\":[]}", Encoding.UTF8, "application/json")
            });
        }
    }
}
