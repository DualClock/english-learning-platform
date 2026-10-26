using System.Net;
using System.Text;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// R9: пак вместо квоты, на трёх словах разной формы.
///
/// <see cref="SpeechPackTests"/> (владелец — Media) уже доказывает принцип на
/// одном слове. Здесь закрывается то, что рвётся чаще всего в проде: слово из
/// книги приходит с заглавной («Alice»), словосочетание — с пробелом внутри
/// («white rabbit»), а словарь ищет его в нижнем регистре. Каждый случай
/// проверяется одинаково жёстко: файл есть → байты из пака → HTTP-вызовов 0.
///
/// Хендлер бросает исключение на любую попытку сети, поэтому «0 вызовов» —
/// это не настройка, а факт: сервис не мог незаметно сходить к провайдеру.
/// </summary>
public class SpeechPackCoverageTestsAudioCore : IDisposable
{
    private readonly string _root;

    public SpeechPackCoverageTestsAudioCore()
    {
        _root = Path.Combine(AppContext.BaseDirectory, "elp-packcov-" + Guid.NewGuid().ToString("N"));
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
    /// Имя файла считаем здесь независимо от сервиса: sha256("pack|" + слово в
    /// нижнем регистре со схлопнутыми пробелами). Если генератор пака
    /// (tools/tts-pack/generate.py) и сервер разойдутся, упадёт этот тест.
    /// </summary>
    private static string PackFileName(string word)
    {
        var normalized = string.Join(' ', word.Trim().Split(
            (char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();
        var hash = Convert.ToHexString(
            System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes("pack|" + normalized)))
            .ToLowerInvariant();
        return hash + ".mp3";
    }

    private string PackDirectory => Path.Combine(_root, "uploads", "tts-pack");

    private byte[] WritePackFile(string word)
    {
        Directory.CreateDirectory(PackDirectory);
        var payload = Encoding.UTF8.GetBytes("PACK:" + word.ToLowerInvariant());
        File.WriteAllBytes(Path.Combine(PackDirectory, PackFileName(word)), payload);
        return payload;
    }

    private SpeechService CreateService(HttpMessageHandler handler)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                // Ключи заданы намеренно: иначе провайдер не вызывался бы по
                // другой причине, и «0 вызовов» ничего не доказывало бы.
                ["Gemini:ApiKey"] = "test-key",
                ["Azure:Speech:Key"] = "azure-key",
                ["Azure:Speech:Region"] = "westeurope",
            })
            .Build();

        var resilient = new ResilientAiService(
            configuration,
            NullLogger<ResilientAiService>.Instance,
            new HttpClient(handler),
            Array.Empty<TimeSpan>());

        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase("packcov-" + Guid.NewGuid().ToString("N"))
                .Options);

        return new SpeechService(
            configuration,
            new RootEnvironment(_root),
            NullLogger<SpeechService>.Instance,
            resilient,
            new AzureSpeechService(
                db,
                new SingleHandlerFactory(handler),
                new RootEnvironment(_root),
                configuration,
                NullLogger<AzureSpeechService>.Instance));
    }

    [Theory]
    [InlineData("rabbit")]
    [InlineData("Alice")]
    [InlineData("white rabbit")]
    public async Task Слово_из_пака_отдаётся_без_единого_HTTP_вызова(string word)
    {
        var packed = WritePackFile(word);
        var handler = new ThrowingHandler();
        var service = CreateService(handler);

        var audio = await service.SynthesizeAsync(word, userId: "user-1");

        Assert.NotNull(audio);
        Assert.Equal("audio/mpeg", audio!.ContentType);
        Assert.Equal(packed, audio.Data);
        Assert.Equal(0, handler.Calls);
    }

    [Theory]
    [InlineData("Alice", "alice")]
    [InlineData("White Rabbit", "white rabbit")]
    [InlineData("  Alice  ", "alice")]
    public async Task Регистр_и_пробелы_не_создают_второй_файл(string fromBook, string fromDictionary)
    {
        var packed = WritePackFile(fromDictionary);
        var handler = new ThrowingHandler();
        var service = CreateService(handler);

        var audio = await service.SynthesizeAsync(fromBook, userId: null);

        Assert.NotNull(audio);
        Assert.Equal(packed, audio!.Data);
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task Слово_вне_пака_всё_таки_идёт_к_провайдеру()
    {
        // Обратная сторона: тесты выше не должны проходить из-за того, что
        // озвучка вообще перестала работать.
        var handler = new CountingHandler();
        var service = CreateService(handler);

        var audio = await service.SynthesizeAsync("cheshire", userId: "user-1");

        Assert.True(handler.Calls > 0, "без файла в паке озвучка обязана идти к провайдеру");
        Assert.NotNull(audio);
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

    /// <summary>Любая попытка сети — провал: пак должен был ответить сам.</summary>
    private sealed class ThrowingHandler : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            throw new InvalidOperationException($"Сеть запрещена, а был запрос на {request.RequestUri}");
        }
    }

    /// <summary>Считает вызовы и отдаёт JSON без аудио — важно только, что сходили.</summary>
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
