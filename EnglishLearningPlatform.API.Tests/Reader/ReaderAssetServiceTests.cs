using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.Extensions.Configuration;

namespace EnglishLearningPlatform.API.Tests.Reader;

public class ReaderAssetServiceTests
{
    private static ReaderAssetService CreateService(string root)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-asset-signing-key-with-enough-length"
            })
            .Build();
        return new ReaderAssetService(new TestWebEnvironment(root), configuration);
    }

    [Fact]
    public void BuildUrl_RoundTripsAndRejectsTampering()
    {
        using var test = new TempRoot();
        var service = CreateService(test.Path);
        var hash = new string('a', 64);
        var name = new string('b', 40) + ".png";
        var now = DateTime.UtcNow;

        var url = service.BuildUrl(hash, name, now, TimeSpan.FromHours(1));
        var parts = url.Split("exp=", StringSplitOptions.RemoveEmptyEntries);
        var exp = long.Parse(parts[1].Split('&')[0]);
        var sig = url.Split("sig=")[1];

        Assert.True(service.Validate(hash, name, exp, sig, now));
        Assert.False(service.Validate(hash, name, exp, sig, now.AddHours(2)));
        Assert.False(service.Validate(hash, new string('c', 40) + ".png", exp, sig, now));
        Assert.False(service.Validate("../" + hash, name, exp, sig, now));
    }

    [Fact]
    public async Task SaveImage_WritesContentAddressedFile()
    {
        using var test = new TempRoot();
        var service = CreateService(test.Path);
        var hash = new string('a', 64);

        var saved = await service.SaveImageAsync(hash, "Images/pixel.png", TestEpub.MakePng());

        Assert.NotNull(saved);
        Assert.EndsWith(".png", saved!.Value.Name);
        Assert.Equal(10, saved.Value.Width);
        Assert.Equal(10, saved.Value.Height);
        Assert.True(File.Exists(Path.Combine(service.AssetDirectory(hash), saved.Value.Name)));
        Assert.Equal("image/png", ReaderAssetService.ContentTypeFor(saved.Value.Name));
    }

    [Fact]
    public async Task SaveImage_RejectsNonImageBytes()
    {
        using var test = new TempRoot();
        var service = CreateService(test.Path);

        var saved = await service.SaveImageAsync(new string('a', 64), "broken.png", new byte[] { 1, 2, 3 });

        Assert.Null(saved);
    }

    private sealed class TempRoot : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(
            AppContext.BaseDirectory,
            "elp-assets-" + Guid.NewGuid().ToString("N"));

        public TempRoot()
        {
            Directory.CreateDirectory(Path);
        }

        public void Dispose()
        {
            try
            {
                Directory.Delete(Path, recursive: true);
            }
            catch
            {
                // ignore
            }
        }
    }
}
