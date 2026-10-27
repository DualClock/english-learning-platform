using System.Net;
using Microsoft.Extensions.Logging;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Разбор строки прокси из конфигурации (<c>Gemini:ProxyUrl</c>).
///
/// Один и тот же прокси нужен двум разным слоям: Gemini/OpenAI-совместимый
/// клиент и бесплатные эндпоинты Google. Держать две копии разбора — верный
/// способ получить расхождение: один слой поддерживает <c>socks5h://</c>,
/// другой нет, и «почему у Gemini работает, а у перевода нет» превращается в
/// долгий поиск. Поэтому разбор живёт здесь.
/// </summary>
public static class ProxyFactory
{
    /// <summary>
    /// Создаёт <see cref="WebProxy"/> по строке вида
    /// <c>socks5://user:pass@host:port</c> или <c>http://host:port</c>.
    ///
    /// null — прокси не задан или строка не разобралась: вызывающий идёт
    /// напрямую. Пароль в лог не попадает — только схема, хост и порт.
    /// </summary>
    public static WebProxy? TryCreate(string? proxyUrl, ILogger logger)
    {
        if (string.IsNullOrWhiteSpace(proxyUrl))
        {
            return null;
        }

        try
        {
            var uri = new Uri(proxyUrl.Trim());

            var scheme = uri.Scheme.ToLowerInvariant() switch
            {
                "socks5h" or "socks5" => "socks5",
                "socks4a" or "socks4" => "socks4",
                "http" => "http",
                "https" => "https",
                _ => null
            };

            if (scheme == null)
            {
                logger.LogWarning(
                    "Прокси: неподдерживаемая схема '{Scheme}', идём напрямую",
                    uri.Scheme);
                return null;
            }

            var port = uri.IsDefaultPort || uri.Port <= 0
                ? (scheme is "socks5" or "socks4" ? 1080 : 8080)
                : uri.Port;

            var proxy = new WebProxy
            {
                Address = new Uri($"{scheme}://{uri.Host}:{port}"),
                BypassProxyOnLocal = false,
                UseDefaultCredentials = false
            };

            // Учётные данные необязательны: бывают открытые прокси и IP-авторизация
            if (!string.IsNullOrEmpty(uri.UserInfo))
            {
                var separator = uri.UserInfo.IndexOf(':');
                var user = separator >= 0 ? uri.UserInfo[..separator] : uri.UserInfo;
                var password = separator >= 0 ? uri.UserInfo[(separator + 1)..] : string.Empty;

                if (user.Length > 0)
                {
                    proxy.Credentials = new NetworkCredential(
                        Uri.UnescapeDataString(user),
                        Uri.UnescapeDataString(password));
                }
            }

            logger.LogInformation("Прокси: {Scheme}://{Host}:{Port} (auth: {HasAuth})",
                scheme, uri.Host, port, proxy.Credentials != null ? "yes" : "no");

            return proxy;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Прокси: строка не разобрана, идём напрямую");
            return null;
        }
    }
}
