using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace EnglishLearningPlatform.API.Security;

/// <summary>
/// Ключи партиций rate limiting. За прокси (Render/Timeweb) RemoteIpAddress
/// у всех клиентов = адрес прокси, поэтому лимиты только по IP превращаются
/// в DoS: один скрипт выжигает лимит логина для всей беты (SECURITY_GATE 1.4).
/// Для auth/admin ключ — sha256(IP + нормализованный email из тела запроса):
/// перебор чужого аккаунта по-прежнему ограничен, но 429 одного клиента
/// не блокирует других.
/// </summary>
public static class RateLimitPartitionKeys
{
    // inspected body cap: DTO-тела логина/регистрации заведомо меньше
    private const long MaxInspectedBodyBytes = 64 * 1024;

    public static string IpOnly(HttpContext context) =>
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    public static string Identity(HttpContext context)
    {
        var raw = $"{IpOnly(context)}|{TryReadEmail(context)}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
    }

    private static string TryReadEmail(HttpContext context)
    {
        try
        {
            if (!HttpMethods.IsPost(context.Request.Method))
            {
                return string.Empty;
            }

            if (context.Request.ContentType == null ||
                !context.Request.ContentType.Contains("application/json", StringComparison.OrdinalIgnoreCase))
            {
                return string.Empty;
            }

            if (context.Request.ContentLength is not (> 0 and <= MaxInspectedBodyBytes))
            {
                return string.Empty;
            }

            // Партиция считается ДО model binding: тело читаем через buffering
            // и возвращаем позицию в начало, чтобы MVC прочитал его заново.
            context.Request.EnableBuffering();
            context.Request.Body.Position = 0;
            string body;
            using (var reader = new StreamReader(
                       context.Request.Body, Encoding.UTF8,
                       detectEncodingFromByteOrderMarks: false, leaveOpen: true))
            {
                body = reader.ReadToEnd();
            }

            context.Request.Body.Position = 0;

            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                return string.Empty;
            }

            foreach (var property in doc.RootElement.EnumerateObject())
            {
                if (string.Equals(property.Name, "email", StringComparison.OrdinalIgnoreCase) &&
                    property.Value.ValueKind == JsonValueKind.String)
                {
                    return (property.Value.GetString() ?? string.Empty).Trim().ToLowerInvariant();
                }
            }

            return string.Empty;
        }
        catch (Exception)
        {
            // Битое или хитрое тело не должно ломать rate limiting —
            // остаёмся на IP-партиции
            return string.Empty;
        }
    }
}
