using System.Security.Claims;
using System.Text;
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

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// Лимит озвучки (R7).
///
/// Раньше и контроллер, и сервис молча обрезали текст до 300 символов: абзац
/// книги (≈400 символов) терял конец, и это не было видно ни в UI, ни в логах.
/// Здесь проверяется обратное: длинный текст доезжает до провайдера ЦЕЛИКОМ,
/// частями по границам предложений.
///
/// Gemini и GTX в этих тестах не ходят в сеть вовсе: Azure — единственный
/// провайдер, который умеет резать и склеивать MP3, поэтому проверка идёт через
/// него с подменённым наследником. Если сервис снова начнёт резать текст по
/// буквам, сумма кусков окажется меньше исходного текста и тест упадёт.
/// </summary>
public class SpeechSplitTests : IDisposable
{
    private readonly string _root;
    private readonly ApplicationDbContext _db;

    public SpeechSplitTests()
    {
        _root = Path.Combine(AppContext.BaseDirectory, "elp-split-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);

        _db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase("split-" + Guid.NewGuid().ToString("N"))
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
            // временная папка теста, чистить её не обязательно
        }
    }

    private IConfiguration Configuration => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            // Ключ Gemini задан намеренно: если сервис пойдёт в Gemini, тест
            // упадёт на запрещённой сети, а не тихо пройдёт по пустому ключу.
            ["Gemini:ApiKey"] = "test-key",
            ["Azure:Speech:Key"] = "azure-key",
            ["Azure:Speech:Region"] = "westeurope",
            ["Azure:Speech:MonthlyCharLimit"] = "400000",
        })
        .Build();

    private SpeechService CreateService(AzureSpeechService azure)
    {
        var resilient = new ResilientAiService(
            Configuration,
            NullLogger<ResilientAiService>.Instance,
            new HttpClient(new ForbiddenNetworkHandler()),
            Array.Empty<TimeSpan>());

        return new SpeechService(
            Configuration,
            new RootEnvironment(_root),
            NullLogger<SpeechService>.Instance,
            resilient,
            azure);
    }

    private AudioController CreateController(SpeechService speech) =>
        new(speech, NullLogger<AudioController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity()) }
            }
        };

    /// <summary>
    /// Типичный абзац книги: несколько целых предложений на ≈700 символов. Каждое
    /// предложение короче лимита провайдера, а весь абзац — нет: именно этот
    /// случай раньше обрезался на 300 символах.
    /// </summary>
    private static string Paragraph()
    {
        const string sentence =
            "Alice was beginning to get very tired of sitting by her sister on the bank and of having " +
            "nothing to do: once or twice she had peeped into the book her sister was reading. ";

        var text = string.Concat(Enumerable.Repeat(sentence, 4)).Trim();
        Assert.InRange(text.Length, 650, 700);
        Assert.Equal(4, EnglishLearningPlatform.API.Services.Reader.SentenceSplitter.Split(text).Count);
        return text;
    }

    [Fact]
    public async Task Абзац_уходит_провайдеру_целиком_по_предложениям()
    {
        var azure = new CaptureAzure(_db, _root, Configuration);
        var service = CreateService(azure);
        var text = Paragraph();

        // Абзац (≈690 символов) длиннее одного вызова провайдера — значит его
        // озвучивают частями. Долями, а не одним запросом: куски разных
        // провайдеров нельзя склеить (WAV + MP3), а 180 — общий знаменатель.
        var audio = await service.SynthesizeAsync(text, "user-1");

        Assert.NotNull(audio);
        Assert.True(azure.Requests.Count >= 2, "абзац не влезает в один вызов провайдера");
        Assert.Equal(text.Length, string.Join(' ', azure.Requests).Length);
        Assert.All(azure.Requests, part => Assert.EndsWith(".", part));
        Assert.All(azure.Requests, part => Assert.True(part.Length <= SpeechService.MaxProviderCharsPerCall));
    }

    /// <summary>
    /// Текст, не влезающий в ОДИН вызов, режется по словам, а не по буквам:
    /// склейка MP3 на середине слова звучала бы как «rab|bit».
    /// </summary>
    [Fact]
    public async Task Текст_без_точек_за_лимитом_режется_по_словам_а_не_по_буквам()
    {
        var azure = new CaptureAzure(_db, _root, Configuration);
        var service = CreateService(azure);

        // 200 слов «rabbit» = 1399 символов — длиннее лимита озвучки.
        var words = Enumerable.Repeat("rabbit", 200).ToArray();
        var text = string.Join(' ', words);

        // 1399 > 1200 — это уже честный отказ, а не нарезка.
        await Assert.ThrowsAsync<SpeechTextTooLongException>(
            () => service.SynthesizeAsync(text, "user-1"));

        // А 1196 символов помещаются в лимит: тогда режем по словам и склеиваем.
        // Счётчик запросов у провайдера общий на тест, поэтому считаем прирост,
        // а не абсолют: первая половина теста (1399 символов) уже ничего не
        // отправила, но так надёжнее не зависеть от порядка.
        var before = azure.Requests.Count;

        var longWords = Enumerable.Repeat("rabbit", 171).ToArray();
        var longText = string.Join(' ', longWords);
        Assert.Equal(1196, longText.Length);
        Assert.Equal(words.Take(171), longWords);

        var longAudio = await service.SynthesizeAsync(longText, "user-1");
        Assert.NotNull(longAudio);

        var sent = azure.Requests.Skip(before).ToList();
        Assert.True(sent.Count >= 2, $"1196 символов не влезают в один вызов, отправлено {sent.Count}: " +
            $"[{string.Join(", ", sent.Select(s => $"{s.Length} симв."))}]");

        foreach (var part in sent)
        {
            Assert.All(part.Split(' '), piece => Assert.Equal("rabbit", piece));
            Assert.True(part.Length <= SpeechService.MaxProviderCharsPerCall, $"{part.Length} больше лимита");
        }
    }

    [Fact]
    public async Task Пустой_текст_не_вызывает_провайдера()
    {
        var azure = new CaptureAzure(_db, _root, Configuration);
        var service = CreateService(azure);

        Assert.Null(await service.SynthesizeAsync("   ", "user-1"));
        Assert.Null(await service.SynthesizeAsync(string.Empty, "user-1"));

        var controller = CreateController(service);
        var response = await controller.GetTts("  \t ", CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(response);
        Assert.Empty(azure.Requests);
    }

    [Fact]
    public async Task Лимит_1200_принимается_а_1201_отклоняется()
    {
        var azure = new CaptureAzure(_db, _root, Configuration);
        var service = CreateService(azure);
        var controller = CreateController(service);

        Assert.Equal(1200, SpeechService.MaxTextLength);

        var accepted = await controller.GetTts(new string('a', 1200), CancellationToken.None);
        Assert.IsNotType<BadRequestObjectResult>(accepted);

        var rejected = await controller.GetTts(new string('a', 1201), CancellationToken.None);
        // 413, а не 400: тело запроса корректно, проблема только в размере.
        var tooLarge = Assert.IsType<ObjectResult>(rejected);
        Assert.Equal(413, tooLarge.StatusCode);
    }

    [Fact]
    public async Task Сервис_не_обрезает_текст_длиннее_лимита_а_отказывает()
    {
        // Второй слой: даже если контроллер пропустил запрос (вызов из другого
        // места), сервис не должен молча озвучить первые 1200 символов из 1201.
        var azure = new CaptureAzure(_db, _root, Configuration);
        var service = CreateService(azure);

        var text = new string('a', SpeechService.MaxTextLength + 1);

        await Assert.ThrowsAsync<SpeechTextTooLongException>(
            () => service.SynthesizeAsync(text, "user-1"));
        Assert.Empty(azure.Requests);
    }

    /// <summary>
    /// Подменяет провайдера: помнит каждый кусок и отдаёт на каждый свой «файл».
    /// Сеть не нужна — важно только, ЧТО и СКОЛЬКО раз попросили озвучить.
    /// </summary>
    private sealed class CaptureAzure : AzureSpeechService
    {
        public CaptureAzure(ApplicationDbContext context, string root, IConfiguration configuration)
            : base(context, new SingleHandlerFactory(), new RootEnvironment(root), configuration,
                NullLogger<AzureSpeechService>.Instance)
        {
        }

        public List<string> Requests { get; } = new();

        /// <summary>Поддельный провайдер отдаёт mp3-кадр (0xFFFB), а не текст.</summary>
        public override Task<AzureSpeechService.SpeechClip?> SynthesizeAsync(
            string text, CancellationToken cancellationToken = default)
        {
            Requests.Add(text);
            var bytes = new byte[] { 0xFF, 0xFB, 0x90, 0x64 }
                .Concat(Encoding.UTF8.GetBytes(text))
                .ToArray();
            return Task.FromResult<AzureSpeechService.SpeechClip?>(
                new AzureSpeechService.SpeechClip(bytes, "audio/mpeg", false));
        }
    }

    private sealed class SingleHandlerFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new ForbiddenNetworkHandler(), disposeHandler: false);
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
