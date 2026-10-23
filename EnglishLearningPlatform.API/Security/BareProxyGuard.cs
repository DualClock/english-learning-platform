namespace EnglishLearningPlatform.API.Security;

/// <summary>
/// W1.4.2 (SECURITY_GATE R-02/R-03): предупреждение о «ногом» прокси на старте.
///
/// Приложение с пустым Proxy__TrustedCidrs выглядит полностью рабочим: оно
/// отвечает 200, /health зелёный, письма уходят. Ломается только то, что не
/// видно без живого трафика — все лимиты, партицированные по IP, начинают
/// делить одну корзину на всю бету (один скрипт блокирует всех), а Scheme=https
/// и HSTS не доезжают до клиента. Именно так эта дыра и была пропущена:
/// переменной нет ни в одном артефакте деплоя, и журнал молчал.
///
/// Поэтому на старте пишется явный WARNING текстом, который нельзя принять за
/// фоновую строку.
/// </summary>
public static class BareProxyGuard
{
    /// <summary>
    /// Формулировка для журнала. Первая часть — факт, вторая — последствие для
    /// живых людей, третья — что делать. Менять слова местами можно, выкидывать
    /// «задайте Proxy__TrustedCidrs» нельзя: тест проверяет именно её.
    /// </summary>
    public const string BareProxyWarning =
        "Proxy__TrustedCidrs пуст, а rate limiting включён: " +
        "лимиты партицируются по IP прокси: один клиент блокирует всех, задайте Proxy__TrustedCidrs " +
        "(сети реверс-прокси через запятую, см. DEPLOY.md «Лимиты и доверие прокси»). " +
        "Пока он не задан, RemoteIpAddress = адрес прокси для всех запросов, а HSTS и Scheme=https не доезжают до клиента.";

    public static void WarnIfBareProxy(IConfiguration configuration, ILogger logger, bool ipPartitioningEnabled)
    {
        if (!ipPartitioningEnabled)
        {
            return;
        }

        if (!IsBare(configuration))
        {
            return;
        }

        logger.LogWarning("{Warning}", BareProxyWarning);
    }

    /// <summary>True, если доверенных сетей прокси не задано вовсе.</summary>
    public static bool IsBare(IConfiguration configuration) =>
        string.IsNullOrWhiteSpace(configuration["Proxy:TrustedCidrs"]);
}
