using System.Net;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Загрузка картинки слова из админки.
///
/// Проверяется сервер, а не форма: `accept="image/*"` в браузере — это подсказка
/// для диалога выбора файла, а не защита. Через curl приходит что угодно, и
/// решение «сохранять или нет» принимает только эта сторона.
///
/// Ключевые свойства:
///   1. не-картинка отклоняется и НЕ попадает на диск;
///   2. имя файла генерирует сервер (иначе «../../appsettings.json» пишется
///      куда угодно);
///   3. сохранённый файл — WebP, урезанный до разумного размера;
///   4. удаление чистит и поле, и файл.
/// </summary>
public class AdminWordImageTests
{
    private sealed class TempEnvironment : IWebHostEnvironment
    {
        public string ContentRootPath { get; set; } = NewRoot();

        /// <summary>
        /// Временный корень для теста.
        ///
        /// Не Path.GetTempPath(): на этой машине он ведёт в C:\Temp, куда у
        /// процесса тестов нет прав, и каждый тест падал бы на создании
        /// каталога до проверки самой логики. Берём рабочий каталог сборки —
        /// он заведомо доступен на запись.
        /// </summary>
        private static string NewRoot()
        {
            var root = Path.Combine(
                AppContext.BaseDirectory, "img-tests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(root, "uploads", "word-images"));
            return root;
        }
        public string WebRootPath { get; set; } = string.Empty;
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "tests";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
        public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; } = null!;
    }

    private static (AdminWordImageController Controller, ApplicationDbContext Context, TempEnvironment Env)
        CreateHarness()
    {
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        var env = new TempEnvironment();
        Directory.CreateDirectory(Path.Combine(env.ContentRootPath, "uploads", "word-images"));

        // Реальное LocalMediaStorage на временном каталоге — а не мок: тесты
        // этого файла проверяют в том числе, что файл лёг на диск и что старый
        // файл удалён. Мок вернул бы «получилось» независимо от того, что
        // произошло с файлами.
        var media = new EnglishLearningPlatform.API.Services.Media.LocalMediaStorage(
            Path.Combine(env.ContentRootPath, "uploads"),
            "/uploads",
            Microsoft.Extensions.Logging.Abstractions.NullLogger<EnglishLearningPlatform.API.Services.Media.LocalMediaStorage>.Instance);

        var controller = new AdminWordImageController(
            context, env, media, NullLogger<AdminWordImageController>.Instance);

        return (controller, context, env);
    }

    private static async Task<CategoryWord> SeedWordAsync(ApplicationDbContext context)
    {
        var category = new Category { Name = "Еда", Slug = "food-" + Guid.NewGuid().ToString("N")[..6] };
        context.Categories.Add(category);
        await context.SaveChangesAsync();

        var word = new CategoryWord
        {
            CategoryId = category.Id,
            English = "apple",
            Translation = "яблоко"
        };
        context.CategoryWords.Add(word);
        await context.SaveChangesAsync();
        return word;
    }

    private static IFormFile PngFile(int width = 64, int height = 64, string name = "photo.png")
    {
        using var image = new Image<Rgba32>(width, height, new Rgba32(200, 40, 40));
        var ms = new MemoryStream();
        image.SaveAsPng(ms);
        ms.Position = 0;
        return new FormFile(ms, 0, ms.Length, "file", name);
    }

    private static IFormFile BytesFile(byte[] bytes, string name) =>
        new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", name);

    // ────────────────────────────────────────────────────── успешный путь

    [Fact]
    public async Task ValidPng_IsSavedAsWebp_AndUrlStoredOnWord()
    {
        var (controller, context, env) = CreateHarness();
        var word = await SeedWordAsync(context);

        var result = await controller.UploadImage(word.Id, PngFile(), default);

        Assert.IsType<OkObjectResult>(result.Result);

        var saved = await context.CategoryWords.SingleAsync(w => w.Id == word.Id);
        Assert.NotNull(saved.ImageUrl);
        Assert.StartsWith("/uploads/word-images/", saved.ImageUrl);
        Assert.EndsWith(".webp", saved.ImageUrl);

        var fileName = saved.ImageUrl!.Split('/').Last();
        var path = Path.Combine(env.ContentRootPath, "uploads", "word-images", fileName);
        Assert.True(File.Exists(path), "файл должен лежать на диске");

        // Сохранён именно WebP — иначе карточка получила бы формат, который
        // мы не обещали отдавать.
        using var check = await Image.LoadAsync(path);
        Assert.Equal("webp", check.Metadata.DecodedImageFormat?.Name.ToLowerInvariant());
    }

    [Fact]
    public async Task LargeImage_IsDownscaled()
    {
        var (controller, context, env) = CreateHarness();
        var word = await SeedWordAsync(context);

        await controller.UploadImage(word.Id, PngFile(width: 2000, height: 1500), default);

        var saved = await context.CategoryWords.SingleAsync(w => w.Id == word.Id);
        var path = Path.Combine(env.ContentRootPath, "uploads", "word-images", saved.ImageUrl!.Split('/').Last());

        using var image = await Image.LoadAsync(path);
        Assert.True(image.Width <= 512 && image.Height <= 512,
            $"картинка не урезана: {image.Width}×{image.Height}");
        // Пропорции сохранены: 4:3 остаётся 4:3.
        Assert.InRange((double)image.Width / image.Height, 1.25, 1.42);
    }

    [Fact]
    public async Task Reupload_ReplacesUrlAndDeletesOldFile()
    {
        var (controller, context, env) = CreateHarness();
        var word = await SeedWordAsync(context);

        await controller.UploadImage(word.Id, PngFile(), default);
        var first = (await context.CategoryWords.AsNoTracking().SingleAsync(w => w.Id == word.Id)).ImageUrl!;
        var firstPath = Path.Combine(env.ContentRootPath, "uploads", "word-images", first.Split('/').Last());

        await controller.UploadImage(word.Id, PngFile(), default);
        var second = (await context.CategoryWords.AsNoTracking().SingleAsync(w => w.Id == word.Id)).ImageUrl!;

        Assert.NotEqual(first, second);
        Assert.False(File.Exists(firstPath), "старый файл должен быть удалён");
    }

    // ──────────────────────────────────────────────────────── отказы

    [Fact]
    public async Task NonImage_IsRejected_AndNothingWrittenToDisk()
    {
        var (controller, context, env) = CreateHarness();
        var word = await SeedWordAsync(context);

        // Классическая попытка: имя .png, содержимое — скрипт.
        var payload = System.Text.Encoding.UTF8.GetBytes("<?php system($_GET['c']); ?>");
        var result = await controller.UploadImage(word.Id, BytesFile(payload, "evil.png"), default);

        Assert.IsType<BadRequestObjectResult>(result.Result);

        var saved = await context.CategoryWords.AsNoTracking().SingleAsync(w => w.Id == word.Id);
        Assert.Null(saved.ImageUrl);

        var dir = Path.Combine(env.ContentRootPath, "uploads", "word-images");
        Assert.Empty(Directory.GetFiles(dir));
    }

    [Fact]
    public async Task ClientFileName_IsIgnored_ServerGeneratesName()
    {
        var (controller, context, _) = CreateHarness();
        var word = await SeedWordAsync(context);

        // «../» в имени — попытка выйти из каталога загрузок.
        await controller.UploadImage(word.Id, PngFile(name: "../../appsettings.json"), default);

        var saved = await context.CategoryWords.AsNoTracking().SingleAsync(w => w.Id == word.Id);
        var name = saved.ImageUrl!.Split('/').Last();

        Assert.DoesNotContain("..", name);
        Assert.Matches("^[a-f0-9]{32}\\.webp$", name);
    }

    [Fact]
    public async Task TinyImage_IsRejected()
    {
        var (controller, context, _) = CreateHarness();
        var word = await SeedWordAsync(context);

        var result = await controller.UploadImage(word.Id, PngFile(width: 8, height: 8), default);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task DeletedWord_RejectsUpload()
    {
        var (controller, context, _) = CreateHarness();
        var word = await SeedWordAsync(context);
        word.DeletedAt = DateTime.UtcNow;
        await context.SaveChangesAsync();

        var result = await controller.UploadImage(word.Id, PngFile(), default);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task UnknownWord_Returns404()
    {
        var (controller, _, _) = CreateHarness();

        var result = await controller.UploadImage(9999, PngFile(), default);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // ───────────────────────────────────────────────────────── удаление

    [Fact]
    public async Task DeleteImage_ClearsFieldAndRemovesFile()
    {
        var (controller, context, env) = CreateHarness();
        var word = await SeedWordAsync(context);
        await controller.UploadImage(word.Id, PngFile(), default);

        var saved = await context.CategoryWords.AsNoTracking().SingleAsync(w => w.Id == word.Id);
        var path = Path.Combine(env.ContentRootPath, "uploads", "word-images", saved.ImageUrl!.Split('/').Last());
        Assert.True(File.Exists(path));

        await controller.DeleteImage(word.Id, default);

        var after = await context.CategoryWords.AsNoTracking().SingleAsync(w => w.Id == word.Id);
        Assert.Null(after.ImageUrl);
        Assert.False(File.Exists(path));
    }

    [Fact]
    public async Task DeleteImage_CannotEscapeUploadsDirectory()
    {
        // Если в базе окажется путь с «../», очистка не должна удалить
        // произвольный файл на диске.
        var (controller, context, env) = CreateHarness();
        var word = await SeedWordAsync(context);

        var victim = Path.Combine(env.ContentRootPath, "config.json");
        await File.WriteAllTextAsync(victim, "important");

        word.ImageUrl = "/uploads/word-images/../../../config.json";
        await context.SaveChangesAsync();

        await controller.DeleteImage(word.Id, default);

        Assert.True(File.Exists(victim), "файл вне каталога загрузок удалять нельзя");
    }
}
