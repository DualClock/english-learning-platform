using EnglishLearningPlatform.API.Services;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace EnglishLearningPlatform.API.Tests;

public class WordImageServiceTests
{
    [Theory]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }, ".jpg")]
    [InlineData(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, ".png")]
    [InlineData(new byte[] { 0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50 }, ".webp")]
    public void DetectExtension_RecognizesSupportedImages(byte[] header, string expected)
    {
        Assert.Equal(expected, WordImageService.DetectExtension(header));
    }

    [Fact]
    public void DetectExtension_RejectsGif()
    {
        Assert.Null(WordImageService.DetectExtension(new byte[] { 0x47, 0x49, 0x46, 0x38, 0x39, 0x61 }));
    }

    [Fact]
    public async Task SaveUploadedImageAsync_OversizedStream_RejectedBeforeDecoding()
    {
        var oversized = new MemoryStream(new byte[WordImageService.MaxFileSizeBytes + 1]);

        await Assert.ThrowsAsync<WordImageValidationException>(
            () => WordImageService.SaveUploadedImageAsync(oversized, oversized.Length));
    }

    [Fact]
    public async Task SaveUploadedImageAsync_WrongSignature_Rejected()
    {
        var fake = new MemoryStream(new byte[1024]);

        await Assert.ThrowsAsync<WordImageValidationException>(
            () => WordImageService.SaveUploadedImageAsync(fake, fake.Length));
    }

    [Fact]
    public async Task SaveUploadedImageAsync_ValidPng_ResizesAndCanBeDeleted()
    {
        using var source = new Image<Rgba32>(1200, 800, new Rgba32(35, 139, 137));
        await using var png = new MemoryStream();
        await source.SaveAsPngAsync(png);
        png.Position = 0;

        var url = await WordImageService.SaveUploadedImageAsync(png, png.Length);
        var path = Path.Combine(
            WordImageService.GetWordImagesDirectory(),
            Path.GetFileName(url));

        try
        {
            Assert.StartsWith(WordImageService.UploadedUrlPrefix, url);
            Assert.True(File.Exists(path));

            using var saved = await Image.LoadAsync(path);
            Assert.True(saved.Width <= WordImageService.MaxDimension);
            Assert.True(saved.Height <= WordImageService.MaxDimension);
            Assert.Equal(1.5, (double)saved.Width / saved.Height, 2);
        }
        finally
        {
            WordImageService.DeleteUploadedImage(url);
        }

        Assert.False(File.Exists(path));
    }

    [Fact]
    public void DeleteUploadedImage_IgnoresArbitraryUrls()
    {
        // Нельзя удалить файл вне каталога визуалов через подставной URL.
        WordImageService.DeleteUploadedImage("/uploads/avatars/not-ours.png");
        WordImageService.DeleteUploadedImage("../../appsettings.json");
    }
}
