using System.Security.Cryptography;
using System.Text;

namespace EnglishLearningPlatform.API.Security;

/// <summary>
/// Проверка административного ключа (X-Seed-Key) для служебных endpoint'ов:
/// сидов контента, сводки аналитики и чтения отзывов.
/// Сравнение — постоянное по времени: побайтовое != даёт тайминг-оракул,
/// по которому ключ можно подбирать посимвольно.
/// </summary>
public static class AdminKeyGuard
{
    public static bool IsAuthorized(string? providedKey, string? configuredKey, bool isDevelopment)
    {
        // Ключ не настроен: локальная разработка открыта, прод — закрыт.
        if (string.IsNullOrEmpty(configuredKey))
        {
            return isDevelopment;
        }

        return FixedTimeEquals(providedKey, configuredKey);
    }

    public static bool FixedTimeEquals(string? provided, string? expected)
    {
        if (provided is null || expected is null)
        {
            return false;
        }

        // Хэши фиксированной длины: сравнение не зависит от длины входа
        // и не утекает её через BranchTarget.
        var providedHash = SHA256.HashData(Encoding.UTF8.GetBytes(provided));
        var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(expected));

        return CryptographicOperations.FixedTimeEquals(providedHash, expectedHash);
    }
}
