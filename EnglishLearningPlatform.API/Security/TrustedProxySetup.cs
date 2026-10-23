using System.Net;
using System.Net.Sockets;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using IpNetwork = System.Net.IPNetwork;

namespace EnglishLearningPlatform.API.Security;

/// <summary>
/// Доверие X-Forwarded-* только явным сетям реверс-прокси из
/// Proxy__TrustedCidrs (запятая: "10.0.0.0/24, 203.0.113.5").
/// Пустое значение = не доверять никому — RemoteIpAddress остаётся
/// адресом непосредственного пира, поведение как до фикса.
/// .NET 10: используем KnownIPNetworks (System.Net.IPNetwork); устаревшие
/// KnownNetworks/KnownProxies принудительно очищаем, включая loopback-дефолты:
/// доверять им на облачном хосте нельзя (sidecar ≠ прокси).
/// </summary>
public static class TrustedProxySetup
{
    public static void Configure(ForwardedHeadersOptions options, string? trustedCidrs)
    {
#pragma warning disable ASPDEPR005 // устаревшие KnownNetworks/KnownProxies очищаем намеренно:
        options.KnownNetworks.Clear();   // если их не тронуть, там останется loopback-дефолт,
        options.KnownProxies.Clear();    // а доверять loopback-соседу на облачном хосте нельзя
#pragma warning restore ASPDEPR005
        options.KnownIPNetworks.Clear();
        options.ForwardedHeaders = ForwardedHeaders.None;

        if (string.IsNullOrWhiteSpace(trustedCidrs))
        {
            return;
        }

        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

        foreach (var entry in trustedCidrs.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!TryNormalizeCidr(entry, out var normalized, out var isIpv4))
            {
                continue;
            }

            options.KnownIPNetworks.Add(IpNetwork.Parse(normalized));

            // Kestrel на dual-mode сокетах отдаёт IPv4 как ::ffff:a.b.c.d —
            // без зеркала в IPv6-формате реальная адресация прокси может не совпасть
            if (isIpv4)
            {
                options.KnownIPNetworks.Add(IpNetwork.Parse(ToV4MappedForm(normalized)));
            }
        }
    }

    private static bool TryNormalizeCidr(string entry, out string normalized, out bool isIpv4)
    {
        normalized = string.Empty;
        isIpv4 = false;

        var slashIndex = entry.IndexOf('/');
        var ipPart = slashIndex >= 0 ? entry[..slashIndex] : entry;

        if (!IPAddress.TryParse(ipPart, out var address))
        {
            return false;
        }

        var maxPrefix = address.AddressFamily == AddressFamily.InterNetworkV6 ? 128 : 32;
        isIpv4 = address.AddressFamily == AddressFamily.InterNetwork;

        var prefixPart = slashIndex >= 0 ? entry[(slashIndex + 1)..] : null;
        var prefix = prefixPart == null
            ? maxPrefix
            : int.TryParse(prefixPart, out var parsedPrefix) ? parsedPrefix : -1;

        if (prefix < 0 || prefix > maxPrefix)
        {
            return false;
        }

        normalized = $"{address}/{prefix}";
        return true;
    }

    private static string ToV4MappedForm(string cidr)
    {
        var slashIndex = cidr.LastIndexOf('/');
        var address = IPAddress.Parse(cidr[..slashIndex]);
        var prefix = int.Parse(cidr[(slashIndex + 1)..]);
        return $"{address.MapToIPv6()}/{prefix + 96}";
    }
}
