using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Processing;

namespace EnglishLearningPlatform.API.Services;

public class WordImageValidationException : Exception
{
    public WordImageValidationException(string message) : base(message) { }
}

/// <summary>
/// Личные изображения слов: принимаем JPG/PNG/WEBP до 1 МБ, перекодируем
/// в PNG (заодно убираем EXIF и пути), уменьшаем длинную сторону до 512 px.
/// Файлы лежат вне публичной статики и отдаются только владельцу.
/// </summary>
public static class WordImageService
{
    public const int MaxFileSizeBytes = 1 * 1024 * 1024;
    public const int MaxDimension = 512;
    public const string UploadedUrlPrefix = "/uploads/word-images/";
    private const long MaxPixels = 25_000_000;

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    public static string? DetectExtension(ReadOnlySpan<byte> header)
    {
        if (header.Length >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF)
            return ".jpg";
        if (header.Length >= 8 && header[..8].SequenceEqual(PngSignature))
            return ".png";
        if (header.Length >= 12
            && header[0] == 0x52 && header[1] == 0x49 && header[2] == 0x46 && header[3] == 0x46
            && header[8] == 0x57 && header[9] == 0x45 && header[10] == 0x42 && header[11] == 0x50)
            return ".webp";
        return null;
    }

    public static string GetWordImagesDirectory() =>
        Path.Combine(Directory.GetCurrentDirectory(), "uploads", "word-images");

    public static async Task<string> SaveUploadedImageAsync(Stream stream, long declaredLength)
    {
        if (declaredLength <= 0 || declaredLength > MaxFileSizeBytes)
            throw new WordImageValidationException("Файл слишком большой. Максимум 1 МБ.");

        using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, MaxFileSizeBytes + 1);
        if (memory.Length > MaxFileSizeBytes)
            throw new WordImageValidationException("Файл слишком большой. Максимум 1 МБ.");

        var bytes = memory.GetBuffer();
        var extension = DetectExtension(bytes.AsSpan(0, (int)Math.Min(memory.Length, 12)));
        if (extension == null)
            throw new WordImageValidationException("Поддерживаются только JPG, PNG и WEBP.");

        try
        {
            memory.Position = 0;
            var info = await Image.IdentifyAsync(memory);
            if (info == null || info.Width <= 0 || info.Height <= 0)
                throw new WordImageValidationException("Не удалось прочитать изображение.");

            if ((long)info.Width * info.Height > MaxPixels)
                throw new WordImageValidationException("Изображение слишком большое по размеру.");

            memory.Position = 0;
            using var image = await Image.LoadAsync(memory);
            image.Mutate(context => context
                .AutoOrient()
                .Resize(new ResizeOptions
                {
                    Mode = ResizeMode.Max,
                    Size = new Size(MaxDimension, MaxDimension)
                }));

            var directory = GetWordImagesDirectory();
            Directory.CreateDirectory(directory);

            var fileName = $"{Guid.NewGuid():N}.png";
            var path = Path.Combine(directory, fileName);
            await image.SaveAsync(path, new PngEncoder());

            return UploadedUrlPrefix + fileName;
        }
        catch (WordImageValidationException)
        {
            throw;
        }
        catch (Exception ex) when (ex is UnknownImageFormatException or InvalidImageContentException)
        {
            throw new WordImageValidationException("Не удалось прочитать изображение.");
        }
    }

    public static void DeleteUploadedImage(string? imageUrl)
    {
        if (string.IsNullOrEmpty(imageUrl)
            || !imageUrl.StartsWith(UploadedUrlPrefix, StringComparison.Ordinal))
            return;

        var fileName = Path.GetFileName(imageUrl);
        if (string.IsNullOrEmpty(fileName)) return;

        var path = Path.Combine(GetWordImagesDirectory(), fileName);
        if (File.Exists(path)) File.Delete(path);
    }
}
