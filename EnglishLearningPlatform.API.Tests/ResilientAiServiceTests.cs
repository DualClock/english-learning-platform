using System.Net;
using System.Text;
using System.Text.Json;
using EnglishLearningPlatform.API.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

public class ResilientAiServiceTests
{
    private const string TestModel = "gemini-2.5-flash";
    private const string TestApiKey = "test-key";

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Queue<Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>> _steps;

        public StubHandler(params Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>[] steps)
        {
            _steps = new Queue<Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>>(steps);
        }

        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            var step = _steps.Count > 0 ? _steps.Dequeue() : null;
            if (step == null)
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));
            }

            return step(request, cancellationToken);
        }
    }

    private static HttpResponseMessage OkEnvelope(string text = "hello") => new(HttpStatusCode.OK)
    {
        Content = new StringContent(
            JsonSerializer.Serialize(new
            {
                candidates = new[]
                {
                    new { content = new { parts = new[] { new { text } } } }
                }
            }),
            Encoding.UTF8, "application/json")
    };

    private static HttpResponseMessage Status(HttpStatusCode code) => new(code)
    {
        Content = new StringContent("{}", Encoding.UTF8, "application/json")
    };

    private static ResilientAiService CreateService(
        HttpMessageHandler handler,
        IDictionary<string, string?>? configOverrides = null)
    {
        var config = new Dictionary<string, string?>
        {
            ["Ai:TimeoutSeconds"] = "5",
            ["Ai:MaxRetries"] = "3"
        };

        if (configOverrides != null)
        {
            foreach (var (key, value) in configOverrides)
            {
                config[key] = value;
            }
        }

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(config)
            .Build();

        // Нулевые задержки между попытками, чтобы тесты не ждали 1s/2s/4s
        return new ResilientAiService(
            configuration,
            NullLogger<ResilientAiService>.Instance,
            new HttpClient(handler),
            Array.Empty<TimeSpan>());
    }

    [Fact]
    public async Task SendAsync_RetriesOn429_AndSucceedsOnSecondAttempt()
    {
        var handler = new StubHandler(
            (_, _) => Task.FromResult(Status(HttpStatusCode.TooManyRequests)),
            (_, _) => Task.FromResult(OkEnvelope()));
        var service = CreateService(handler);

        var result = await service.SendAsync(TestModel, new { }, TestApiKey, "test");

        Assert.Equal(2, handler.CallCount);
        Assert.NotNull(result.Json);
        Assert.Contains("candidates", result.Json);
    }

    [Fact]
    public async Task SendAsync_ExhaustsRetries_On5xx_AndThrowsControlledError()
    {
        var handler = new StubHandler(
            (_, _) => Task.FromResult(Status(HttpStatusCode.InternalServerError)));
        var service = CreateService(handler);

        var ex = await Assert.ThrowsAsync<AiUnavailableException>(
            () => service.SendAsync(TestModel, new { }, TestApiKey, "test"));

        Assert.Equal(3, handler.CallCount);
        Assert.Equal(ResilientAiService.UserErrorMessage, ex.Message);
        Assert.DoesNotContain("500", ex.Message);
    }

    [Fact]
    public async Task SendAsync_TimesOut_AndThrowsControlledError()
    {
        // Хэндлер "висит" дольше таймаута из конфига
        var handler = new StubHandler(async (_, ct) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(30), ct);
            return OkEnvelope();
        });
        var service = CreateService(handler, new Dictionary<string, string?>
        {
            ["Ai:TimeoutSeconds"] = "1",
            ["Ai:MaxRetries"] = "2"
        });

        var ex = await Assert.ThrowsAsync<AiUnavailableException>(
            () => service.SendAsync(TestModel, new { }, TestApiKey, "test"));

        Assert.Equal(2, handler.CallCount);
        Assert.Equal(ResilientAiService.UserErrorMessage, ex.Message);
    }

    [Fact]
    public async Task SendAsync_RetriesOnEmptyResponse_AndSucceeds()
    {
        var handler = new StubHandler(
            (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("", Encoding.UTF8, "application/json")
            }),
            (_, _) => Task.FromResult(OkEnvelope()));
        var service = CreateService(handler);

        var result = await service.SendAsync(TestModel, new { }, TestApiKey, "test");

        Assert.Equal(2, handler.CallCount);
        Assert.NotNull(result.Json);
    }

    [Fact]
    public async Task SendAsync_UsesFallbackProvider_WhenConfigured()
    {
        var handler = new StubHandler(
            (_, _) => Task.FromResult(Status(HttpStatusCode.TooManyRequests)),
            (_, _) => Task.FromResult(Status(HttpStatusCode.TooManyRequests)),
            (_, _) => Task.FromResult(OkEnvelope("from fallback")));
        var service = CreateService(handler, new Dictionary<string, string?>
        {
            ["Ai:MaxRetries"] = "2",
            ["Ai:FallbackApiKey"] = "fallback-key",
            ["Ai:FallbackModel"] = "fallback-model"
        });

        var result = await service.SendAsync(TestModel, new { }, TestApiKey, "test");

        Assert.Equal(3, handler.CallCount); // 2 попытки основного + 1 fallback
        Assert.NotNull(result.Json);
    }
}
