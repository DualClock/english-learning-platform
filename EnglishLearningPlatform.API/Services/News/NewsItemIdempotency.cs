using System.Security.Cryptography;
using System.Text;

namespace EnglishLearningPlatform.API.Services.News;

/// <summary>
/// Ключ дедупликации новости: SHA-256 от канонического адреса материала.
///
/// Почему хэш от URL, а не URL целиком: адреса фидов длинные (регулярно за 300
/// символов), а внешний ключ сравнения должен быть коротким и с фиксированной
/// длиной — иначе уникальный индекс в PostgreSQL упирается в предельный размер
/// btree-записи. 64 hex-символа влезают всегда.
///
/// Почему канонический, а не сырой: один и тот же материал приезжает с
/// utm-метками, якорем и трейлинг-слешем. Сырая строка дала бы три хэша и три
/// копии одной новости в ленте — ровно то, от чего индекс и защищает.
/// </summary>
public static class NewsItemIdempotency
{
    /// <summary>Параметры трекинга, которые не меняют адрес материала.</summary>
    private static readonly string[] TrackingPrefixes =
    {
        "utm_", "fbclid", "gclid", "yclid", "mc_cid", "mc_eid", "ref", "source"
    };

    public static string Hash(string sourceUrl)
    {
        var canonical = Canonicalize(sourceUrl);

        // Кодируем в UTF-8: заголовок-то латиницей, но URL вполне может
        // содержать кириллицу в пути, и локаль машины не должна менять хэш.
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));

        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    /// <summary>
    /// Приводит адрес к виду, в котором он однозначен для сравнения:
    /// схема и хост в нижнем регистре, без якоря, без трекинг-параметров,
    /// без трейлинг-слеша у пути.
    /// </summary>
    public static string Canonicalize(string sourceUrl)
    {
        var raw = (sourceUrl ?? string.Empty).Trim();
        if (raw.Length == 0) return string.Empty;

        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri))
        {
            // Невалидный URI всё равно должен дать стабильный ключ — иначе одна
            // и та же кривая ссылка получит новый ключ при каждом опросе.
            return raw.TrimEnd('/');
        }

        var builder = new StringBuilder();
        builder.Append(uri.Scheme.ToLowerInvariant()).Append("://");
        builder.Append(uri.Host.ToLowerInvariant());

        // Порт по умолчанию не пишем: http://host и http://host:80 — один адрес.
        if (!uri.IsDefaultPort) builder.Append(':').Append(uri.Port);

        var path = uri.AbsolutePath.TrimEnd('/');
        builder.Append(path.Length == 0 ? "/" : path);

        var kept = uri.Query
            .TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Where(pair => !IsTracking(pair))
            .ToList();

        if (kept.Count > 0)
        {
            // Порядок параметров источника не гарантирован; сортировка делает
            // ?a=1&b=2 и ?b=2&a=1 одним ключом.
            kept.Sort(StringComparer.Ordinal);
            builder.Append('?').AppendJoin('&', kept);
        }

        return builder.ToString();
    }

    private static bool IsTracking(string queryPair)
    {
        var key = queryPair.Split('=', 2)[0];
        return TrackingPrefixes.Any(prefix =>
            key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
    }
}
