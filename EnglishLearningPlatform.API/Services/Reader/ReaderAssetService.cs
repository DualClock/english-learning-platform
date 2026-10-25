using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using SixLabors.ImageSharp;

namespace EnglishLearningPlatform.API.Services.Reader;

/// <summary>
/// Картинки книги и подписанные ссылки на них. Внутри EPUB лежат относительные
/// пути и произвольные имена; наружу отдаём только хэш содержимого и короткую
/// подпись, чтобы ссылку нельзя было подобрать и она не жила вечно.
/// </summary>
public sealed class ReaderAssetService
{
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp", ".gif"
    };

    private static readonly Regex AssetNamePattern = new(
        @"^[a-f0-9]{40}\.(jpg|jpeg|png|webp|gif)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ContentHashPattern = new(
        @"^[a-f0-9]{64}$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex AnchorIdPattern = new(
        @"^[A-Za-z0-9\-]{1,80}$",
        RegexOptions.Compiled);

    private readonly IWebHostEnvironment _environment;
    private readonly byte[] _signingKey;

    public ReaderAssetService(IWebHostEnvironment environment, IConfiguration configuration)
    {
        _environment = environment;
        var source = configuration["Reader:AssetKey"];
        if (string.IsNullOrWhiteSpace(source))
        {
            // Отдельный ключ лучше, но не заставляем владельца заводить ещё один
            // секрет ради картинок: JWT-ключ уже есть и ротируется вместе с ним.
            source = configuration["Jwt:Key"] ?? "dev-reader-assets";
        }

        _signingKey = SHA256.HashData(Encoding.UTF8.GetBytes("reader-assets|" + source));
    }

    public string AssetDirectory(string contentHash) =>
        Path.Combine(_environment.ContentRootPath, "uploads", "book-assets", contentHash);

    /// <summary>
    /// Кладёт картинку в хранилище книги. Имя — хэш байтов, поэтому повторный
    /// разбор не создаёт дублей. null — если файл не картинка или формат не
    /// поддерживается (SVG намеренно не пускаем в DOM).
    /// </summary>
    public async Task<(string Name, int? Width, int? Height)?> SaveImageAsync(
        string contentHash,
        string sourcePath,
        byte[] bytes,
        CancellationToken cancellationToken = default)
    {
        if (bytes.Length == 0)
        {
            return null;
        }

        var extension = Path.GetExtension(sourcePath).ToLowerInvariant();
        if (!AllowedExtensions.Contains(extension))
        {
            return null;
        }

        if (extension == ".jpeg")
        {
            extension = ".jpg";
        }

        ImageInfo? info;
        try
        {
            info = Image.Identify(bytes);
        }
        catch
        {
            return null;
        }

        if (info == null || info.Width <= 0 || info.Height <= 0)
        {
            return null;
        }

        var name = Convert.ToHexString(SHA1.HashData(bytes)).ToLowerInvariant() + extension;
        var directory = AssetDirectory(contentHash);
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, name);

        if (!File.Exists(path))
        {
            await File.WriteAllBytesAsync(path, bytes, cancellationToken);
        }

        return (name, info.Width, info.Height);
    }

    public string BuildUrl(string contentHash, string name, DateTime utcNow, TimeSpan ttl)
    {
        var expires = new DateTimeOffset(utcNow.Add(ttl)).ToUnixTimeSeconds();
        var signature = Sign(contentHash, name, expires);
        return $"/api/reader/assets/{contentHash}/{name}?exp={expires}&sig={signature}";
    }

    public bool Validate(string contentHash, string name, long expires, string? signature, DateTime utcNow)
    {
        if (!ContentHashPattern.IsMatch(contentHash) ||
            !AssetNamePattern.IsMatch(name) ||
            string.IsNullOrWhiteSpace(signature) ||
            expires <= new DateTimeOffset(utcNow).ToUnixTimeSeconds())
        {
            return false;
        }

        var expected = Sign(contentHash, name, expires);
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(expected),
            Encoding.ASCII.GetBytes(signature));
    }

    public string? GetExistingPath(string contentHash, string name)
    {
        if (!ContentHashPattern.IsMatch(contentHash) || !AssetNamePattern.IsMatch(name))
        {
            return null;
        }

        var path = Path.Combine(AssetDirectory(contentHash), name);
        return File.Exists(path) ? path : null;
    }

    /// <summary>
    /// Ссылка на озвучку предложения. Тег audio не умеет отправлять
    /// Authorization, поэтому права подтверждаются подписью: она выдаётся
    /// только владельцу книги и живёт ограниченное время.
    /// </summary>
    public string BuildSpeechUrl(
        int bookId,
        string chapterId,
        string sentenceId,
        DateTime utcNow,
        TimeSpan ttl)
    {
        var expires = new DateTimeOffset(utcNow.Add(ttl)).ToUnixTimeSeconds();
        var signature = SignSpeech(bookId, chapterId, sentenceId, expires);
        return $"/api/reader/books/{bookId}/chapters/{Uri.EscapeDataString(chapterId)}" +
               $"/speech/{Uri.EscapeDataString(sentenceId)}?exp={expires}&sig={signature}";
    }

    public bool ValidateSpeech(
        int bookId,
        string chapterId,
        string sentenceId,
        long expires,
        string? signature,
        DateTime utcNow)
    {
        if (!AnchorIdPattern.IsMatch(chapterId) ||
            !AnchorIdPattern.IsMatch(sentenceId) ||
            string.IsNullOrWhiteSpace(signature) ||
            expires <= new DateTimeOffset(utcNow).ToUnixTimeSeconds())
        {
            return false;
        }

        var expected = SignSpeech(bookId, chapterId, sentenceId, expires);
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(expected),
            Encoding.ASCII.GetBytes(signature));
    }

    public static string ContentTypeFor(string name) =>
        Path.GetExtension(name).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            _ => "image/jpeg"
        };

    private string Sign(string contentHash, string name, long expires)
    {
        var payload = $"{contentHash}/{name}/{expires}";
        var hash = HMACSHA256.HashData(_signingKey, Encoding.UTF8.GetBytes(payload));
        return Convert.ToBase64String(hash)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private string SignSpeech(int bookId, string chapterId, string sentenceId, long expires) =>
        Sign("speech", $"{bookId}/{chapterId}/{sentenceId}", expires);
}
