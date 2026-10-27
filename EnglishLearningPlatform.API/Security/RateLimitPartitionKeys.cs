using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace EnglishLearningPlatform.API.Security;

/// <summary>
/// Ключи партиций rate limiting. За прокси (Render/Timeweb) RemoteIpAddress
/// у всех клиентов = адрес прокси, поэтому лимиты только по IP превращаются
/// в DoS: один скрипт выжигает лимит логина для всей беты (SECURITY_GATE 1.4).
/// Для auth ключ — sha256(IP + нормализованный email из тела запроса):
/// перебор чужого аккаунта по-прежнему ограничен, но 429 одного клиента
/// не блокирует других.
/// Для регистрации (W1.4.1) ключ — сам email: школа или офис за одним NAT
/// — это десятки разных людей, и лимит «5 в час на IP» отрезал их всех.
/// Для admin тело запроса не читается: там нет email, поэтому партиция
/// строится по значению административного ключа (X-Seed-Key), а запросы
/// без ключа — по IP. Иначе все админские вызовы мира попадали бы в одну
/// корзину, и любой мог бы закрыть владельцу его же дашборд (R-05).
/// </summary>
public static class RateLimitPartitionKeys
{
    // inspected body cap: DTO-тела логина/регистрации заведомо меньше
    private const long MaxInspectedBodyBytes = 64 * 1024;

    /// <summary>Заголовок, которым защищены служебные эндпоинты (AdminKeyGuard).</summary>
    public const string AdminKeyHeader = "X-Seed-Key";

    public static string IpOnly(HttpContext context) =>
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    public static string Identity(HttpContext context)
    {
        var raw = $"{IpOnly(context)}|{EmailFromBody(context)}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
    }

    /// <summary>
    /// Ключ партиции регистрации: нормализованный email, а не IP. Если email
    /// в теле не читается (битый JSON, запрос без тела, чужой Content-Type),
    /// ключ падает в bucket «без email» на конкретном IP — такие запросы всё
    /// равно ограничены, но не съедают бюджет реальных адресов и не сливаются
    /// в одну общую корзину на весь мир.
    /// </summary>
    public static string SignupEmail(HttpContext context)
    {
        var email = EmailFromBody(context);
        return email.Length == 0
            ? $"no-email|{IpOnly(context)}"
            : Hash($"email|{email}");
    }

    /// <summary>
    /// Партиция админских эндпоинтов.
    ///
    /// Ключ — id пользователя из успешной аутентификации, а не заголовок
    /// X-Seed-Key: с CMS-0 админка защищена ролью ([Authorize(Roles=Admin)]),
    /// и никакого ключа в запросе больше нет. Пока здесь читался отсутствующий
    /// заголовок, условие всегда падало в ветку "ip:{...}" — то есть все
    /// администраторы мира делили одну корзину в 10 запросов на 5 минут.
    ///
    /// До аутентификации (запрос без токена) Name пуст — такому запросу и
    /// положено попадать в общий IP-bucket: он всё равно получит 401/403.
    /// </summary>
    public static string AdminIdentity(HttpContext context)
    {
        var userId = context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        return string.IsNullOrWhiteSpace(userId)
            ? $"ip:{IpOnly(context)}"
            : $"admin:{Hash(userId)}";
    }

    /// <summary>Нормализованный email из JSON-тела запроса; "" если его нет.</summary>
    public static string EmailFromBody(HttpContext context)
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

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
