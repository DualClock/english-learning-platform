using System.Net;
using System.Text;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Reader;

/// <summary>
/// Azure Speech: подпись ссылок, SSML, кэш и месячный бюджет. Бюджет — самая
/// дорогая ошибка этого модуля: без него один читатель с автоперелистыванием
/// выжигает месячную квоту платформы за вечер.
/// </summary>
public class AzureSpeechServiceTests : IDisposable
{
    private readonly string _root;
    private readonly ApplicationDbContext _db;
    private readonly TestWebEnvironment _environment;

    public AzureSpeechServiceTests()
    {
        _root = Path.Combine(AppContext.BaseDirectory, "elp-speech-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("speech-" + Guid.NewGuid().ToString("N"))
            .Options;
        _db = new ApplicationDbContext(options);
        _environment = new TestWebEnvironment(_root);
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
            // временная папка теста, чистить её не обязательно
        }
    }

    private AzureSpeechService CreateService(
        HttpMessageHandler? handler = null,
        string? key = "test-key",
        string? region = "westeurope",
        int limit = 400_000)
    {
        var settings = new Dictionary<string, string?>
        {
            ["Azure:Speech:Key"] = key,
            ["Azure:Speech:Region"] = region,
            ["Azure:Speech:Voice"] = "en-US-AriaNeural",
            ["Azure:Speech:MonthlyCharLimit"] = limit.ToString()
        };

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var factory = new StubHttpClientFactory(handler ?? new ThrowingHandler());

        return new AzureSpeechService(
            _db,
            factory,
            _environment,
            configuration,
            NullLogger<AzureSpeechService>.Instance);
    }

    [Fact]
    public async Task Без_ключа_сервис_не_настроен_и_молчит()
    {
        var service = CreateService(key: null, region: null);

        Assert.False(service.IsConfigured);
        Assert.Null(await service.SynthesizeAsync("Alice was beginning"));
    }

    [Fact]
    public void SSML_экранирует_текст_книги()
    {
        var service = CreateService();
        var ssml = service.BuildSsml("Tom & Jerry <said> \"hello\"");

        Assert.Contains("&amp;", ssml);
        Assert.Contains("&lt;said&gt;", ssml);
        Assert.DoesNotContain("<said>", ssml);
        Assert.Contains("en-US-AriaNeural", ssml);
        Assert.Contains("rate=\"-10%\"", ssml);
    }

    [Fact]
    public async Task Кэш_не_тратит_бюджет_и_не_ходит_в_сеть()
    {
        var service = CreateService(handler: new ThrowingHandler());
        var text = "The pool of tears";
        var name = service.CacheName(text);

        Directory.CreateDirectory(service.CacheDirectory);
        await File.WriteAllBytesAsync(Path.Combine(service.CacheDirectory, name), new byte[] { 1, 2, 3 });

        var clip = await service.SynthesizeAsync(text);

        Assert.NotNull(clip);
        Assert.True(clip!.FromCache);
        Assert.Equal(0, await service.GetUsedCharsAsync());
    }

    [Fact]
    public async Task Успешный_синтез_пишет_кэш_и_считает_символы()
    {
        var handler = new AudioHandler(new byte[] { 9, 9, 9 });
        var service = CreateService(handler);

        var clip = await service.SynthesizeAsync("Down the rabbit-hole");

        Assert.NotNull(clip);
        Assert.False(clip!.FromCache);
        Assert.True(File.Exists(Path.Combine(service.CacheDirectory, service.CacheName("Down the rabbit-hole"))));
        Assert.Equal("Down the rabbit-hole".Length, await service.GetUsedCharsAsync());

        var again = await service.SynthesizeAsync("Down the rabbit-hole");
        Assert.True(again!.FromCache);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task Месячный_лимит_останавливает_Azure_до_запроса()
    {
        var handler = new AudioHandler(new byte[] { 7 });
        var service = CreateService(handler, limit: 1_000);

        var first = await service.SynthesizeAsync(new string('a', 600));
        Assert.NotNull(first);

        var second = await service.SynthesizeAsync(new string('b', 600));

        Assert.Null(second);
        Assert.Equal(1, handler.Calls);
        Assert.Equal(600, await service.GetUsedCharsAsync());
    }

    [Fact]
    public async Task Отказ_провайдера_возвращает_деньги_бюджета()
    {
        var service = CreateService(new StatusHandler(HttpStatusCode.InternalServerError));

        var clip = await service.SynthesizeAsync("Anything at all");

        Assert.Null(clip);
        Assert.Equal(0, await service.GetUsedCharsAsync());
    }

    [Fact]
    public void Ссылка_на_озвучку_подписана_и_проверяется()
    {
        var assets = new ReaderAssetService(_environment, new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:Key"] = new string('k', 40) })
            .Build());

        var now = DateTime.UtcNow;
        var url = assets.BuildSpeechUrl(5, "c03-a1b2c3d4", "s2-1", now, TimeSpan.FromHours(1));

        Assert.Contains("/api/reader/books/5/chapters/c03-a1b2c3d4/speech/s2-1", url);

        var query = new Uri("https://x" + url).Query.TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .ToDictionary(part => part[0], part => Uri.UnescapeDataString(part[1]));
        var exp = long.Parse(query["exp"]);
        var sig = query["sig"];

        Assert.True(assets.ValidateSpeech(5, "c03-a1b2c3d4", "s2-1", exp, sig, now));
        Assert.False(assets.ValidateSpeech(6, "c03-a1b2c3d4", "s2-1", exp, sig, now));
        Assert.False(assets.ValidateSpeech(5, "c03-a1b2c3d4", "s2-1", exp, sig, now.AddHours(2)));
        Assert.False(assets.ValidateSpeech(5, "c03-a1b2c3d4", "s2-1", exp, "подделка", now));
    }

    private sealed class StubHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class AudioHandler(byte[] payload) : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(payload)
            });
        }
    }

    private sealed class StatusHandler(HttpStatusCode status) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status));
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Сеть в этом тесте запрещена");
    }
}
