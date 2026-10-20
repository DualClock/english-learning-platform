using EnglishLearningPlatform.API.Services;

namespace EnglishLearningPlatform.API.Tests;

public class AvatarServiceTests
{
    private static readonly byte[] JpegHeader = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
    private static readonly byte[] PngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] WebpHeader = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

    [Fact]
    public void DetectExtension_JpegSignature_ReturnsJpg() =>
        Assert.Equal(".jpg", AvatarService.DetectExtension(JpegHeader));

    [Fact]
    public void DetectExtension_PngSignature_ReturnsPng() =>
        Assert.Equal(".png", AvatarService.DetectExtension(PngHeader));

    [Fact]
    public void DetectExtension_WebpSignature_ReturnsWebp() =>
        Assert.Equal(".webp", AvatarService.DetectExtension(WebpHeader));

    [Fact]
    public void DetectExtension_WrongSignature_ReturnsNull()
    {
        // GIF под видом jpg — должен быть отклонён
        var gifHeader = new byte[] { 0x47, 0x49, 0x46, 0x38, 0x39, 0x61 };
        Assert.Null(AvatarService.DetectExtension(gifHeader));
    }

    [Fact]
    public void DetectExtension_TooShort_ReturnsNull() =>
        Assert.Null(AvatarService.DetectExtension(new byte[] { 0xFF }));

    [Theory]
    [InlineData("avatar-1", true)]
    [InlineData("avatar-10", true)]
    [InlineData("avatar-0", false)]
    [InlineData("avatar-11", false)]
    [InlineData("../avatar-1", false)]
    [InlineData("avatar-1.svg", false)]
    [InlineData(null, false)]
    public void IsValidDefaultAvatarName_ChecksAllowlist(string? name, bool expected) =>
        Assert.Equal(expected, AvatarService.IsValidDefaultAvatarName(name));

    [Fact]
    public async Task SaveUploadedAvatarAsync_OversizedStream_Rejected()
    {
        // Файл больше лимита 2 МБ отклоняется до любой обработки
        var oversized = new MemoryStream(new byte[AvatarService.MaxFileSizeBytes + 1]);
        await Assert.ThrowsAsync<AvatarValidationException>(
            () => AvatarService.SaveUploadedAvatarAsync(oversized, oversized.Length));
    }

    [Fact]
    public async Task SaveUploadedAvatarAsync_WrongSignature_Rejected()
    {
        var fake = new MemoryStream(new byte[1024]); // нули — нет валидной сигнатуры
        await Assert.ThrowsAsync<AvatarValidationException>(
            () => AvatarService.SaveUploadedAvatarAsync(fake, fake.Length));
    }
}
