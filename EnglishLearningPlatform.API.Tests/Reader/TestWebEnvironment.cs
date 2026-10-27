using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;

namespace EnglishLearningPlatform.API.Tests.Reader;

internal sealed class TestWebEnvironment : IWebHostEnvironment
{
    public TestWebEnvironment(string contentRootPath)
    {
        ContentRootPath = contentRootPath;
    }

    public string ApplicationName { get; set; } = "test";
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    public string EnvironmentName { get; set; } = "Development";
    public string WebRootName { get; set; } = "wwwroot";
    public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    public string WebRootPath { get; set; } = string.Empty;
    public string ContentRootPath { get; set; } = string.Empty;
}
