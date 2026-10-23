using System.Security.Cryptography;
using System.Text;

namespace EnglishLearningPlatform.API.Security;

/// <summary>
/// Идентификация гостя для анонимной аналитики (W2.4).
///
/// Гостевая воронка должна отвечать на вопрос «сколько людей дошли до
/// результата», не превращаясь в слежку. Поэтому в базе лежит не IP, а
/// <see cref="IpHash">хеш</see> от IP с суточной солью:
///
///  - обратного сопоставления нет: из хеша IP не восстанавливается, и соль в
///    базе не хранится;
///  - хеш живёт ровно сутки: соль выводится из ключа и даты, поэтому запись
///    вчерашнего дня уже не сопоставить с сегодняшней, а человек, который
///    заходил завтра, — это снова «неизвестный». Никакого трекинга между
///    сессиями, никаких cookie: мы меряем воронку, а не персонажа;
///  - один и тот же IP в рамках суток даёт один и тот же хеш, поэтому «сколько
///    разных гостей» считать можно (с оговоркой про NAT: семья за роутером —
///    один гость, и это честно: другого средства различить их у нас нет).
///
/// Ключ соли — `Analytics:GuestIpSalt` (env `Analytics__GuestIpSalt`). Пока его
/// нет, берётся случайный ключ процесса: хеши остаются необратимыми и меняются
/// на каждом рестарте, просто «уникальные гости» за сутки на нескольких
/// репликах будут считаться хуже. Это безопасный фолбэк, а не дыра: он делает
/// сопоставление строже, а не мягче.
/// </summary>
public static class GuestIdentity
{
    /// <summary>
    /// Фолбэк-ключ: генерируется один раз на процесс. Специально не константа —
    /// иначе хеши стали бы предсказуемыми для любого, кто прочитал репозиторий.
    /// </summary>
    private static readonly string ProcessSalt =
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    /// <summary>Используемый процессом соль-ключ: настроенный или случайный.</summary>
    public static string ResolveSalt(string? configuredSalt) =>
        string.IsNullOrWhiteSpace(configuredSalt) ? ProcessSalt : configuredSalt.Trim();

    /// <summary>True, если ключ соли задан оператором (иначе — временный ключ процесса).</summary>
    public static bool HasConfiguredSalt(string? configuredSalt) =>
        !string.IsNullOrWhiteSpace(configuredSalt);

    /// <summary>
    /// Суточный соль-ключ: HMAC(secret, дата). Сам суточный ключ в базу не
    /// пишется и из записи не выводится — без секрета даже проверка «совпадает
    /// ли этот хеш с моим IP» невозможна.
    /// </summary>
    public static string DailySaltKey(string salt, DateOnly day) =>
        Convert.ToHexString(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(salt),
            Encoding.UTF8.GetBytes($"guest-analytics|{day:yyyy-MM-dd}")));

    /// <summary>
    /// IpHash для записи. <paramref name="ip"/> — адрес пира (после
    /// ForwardedHeaders — настоящий адрес клиента) или "unknown".
    /// </summary>
    public static string IpHash(string salt, DateOnly day, string ip) =>
        Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes($"{DailySaltKey(salt, day)}|{ip}"))).ToLowerInvariant();

    /// <summary>Адрес пира так, как его видит эндпоинт. IP здесь — промежуточное значение, в БД не попадает.</summary>
    public static string ClientIp(HttpContext context) =>
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
}
