using System.Text.RegularExpressions;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;

namespace EnglishLearningPlatform.API.Services;

public class AvatarValidationException : Exception
{
    public AvatarValidationException(string message) : base(message) { }
}

public static partial class AvatarService
{
    public const int MaxFileSizeBytes = 2 * 1024 * 1024;
    public const int AvatarSize = 256;
    public const string UploadedUrlPrefix = "/uploads/avatars/";
    private const long MaxPixels = 25_000_000;

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    [GeneratedRegex(@"^avatar-(?:[1-9]|10)$")]
    private static partial Regex DefaultAvatarNameRegex();

    public static bool IsValidDefaultAvatarName(string? name) =>
        name != null && DefaultAvatarNameRegex().IsMatch(name);

    public static string DefaultAvatarUrl(string name) => $"/avatars/{name}.svg";

    // Определяет формат по магическим байтам, а не по расширению файла
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

    public static string GetAvatarsDirectory() =>
        Path.Combine(Directory.GetCurrentDirectory(), "uploads", "avatars");

    // Обрезает до квадрата, уменьшает до 256x256 и сохраняет под именем GUID
    public static async Task<string> SaveUploadedAvatarAsync(Stream stream, long declaredLength)
    {
        if (declaredLength <= 0 || declaredLength > MaxFileSizeBytes)
            throw new AvatarValidationException("Файл слишком большой. Максимум 2 МБ.");

        using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, MaxFileSizeBytes + 1);
        if (memory.Length > MaxFileSizeBytes)
            throw new AvatarValidationException("Файл слишком большой. Максимум 2 МБ.");

        var bytes = memory.GetBuffer();
        var extension = DetectExtension(bytes.AsSpan(0, (int)Math.Min(memory.Length, 12)));
        if (extension == null)
            throw new AvatarValidationException("Поддерживаются только JPG, PNG и WEBP.");

        var avatarsDir = GetAvatarsDirectory();
        Directory.CreateDirectory(avatarsDir);

        var fileName = $"{Guid.NewGuid():N}{extension}";
        var path = Path.Combine(avatarsDir, fileName);

        try
        {
            memory.Position = 0;
            var info = await Image.IdentifyAsync(memory);
            if (info == null || (long)info.Width * info.Height > MaxPixels)
                throw new AvatarValidationException("Изображение слишком большое по размеру.");

            memory.Position = 0;
            using var image = await Image.LoadAsync(memory);
            var side = Math.Min(image.Width, image.Height);
            image.Mutate(x => x
                .Crop(new Rectangle((image.Width - side) / 2, (image.Height - side) / 2, side, side))
                .Resize(AvatarSize, AvatarSize));
            await image.SaveAsync(path);
        }
        catch (Exception ex) when (ex is UnknownImageFormatException or InvalidImageContentException)
        {
            throw new AvatarValidationException("Не удалось прочитать изображение.");
        }

        return UploadedUrlPrefix + fileName;
    }

    // Удаляет только пользовательские загрузки; базовые аватары (/avatars/...) не трогает
    public static void DeleteUploadedAvatar(string? avatarUrl)
    {
        if (string.IsNullOrEmpty(avatarUrl) || !avatarUrl.StartsWith(UploadedUrlPrefix, StringComparison.Ordinal))
            return;

        var fileName = Path.GetFileName(avatarUrl);
        if (string.IsNullOrEmpty(fileName)) return;

        var path = Path.Combine(GetAvatarsDirectory(), fileName);
        if (File.Exists(path)) File.Delete(path);
    }
}
