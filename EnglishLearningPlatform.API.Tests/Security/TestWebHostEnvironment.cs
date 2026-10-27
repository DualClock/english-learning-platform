using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>Минимальная среда для юнит-тестов контроллеров, без хостинга.</summary>
public sealed class TestWebHostEnvironment : IWebHostEnvironment
{
    public string ApplicationName { get; set; } = "EnglishLearningPlatform.API.Tests";
    public string EnvironmentName { get; set; } = Environments.Production;
    public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
    public string WebRootPath { get; set; } = AppContext.BaseDirectory;
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
}
