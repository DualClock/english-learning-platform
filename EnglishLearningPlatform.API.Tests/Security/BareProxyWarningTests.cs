using System.Net;
using System.Threading.RateLimiting;
using EnglishLearningPlatform.API.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// W1.4.2 (SECURITY_GATE R-02/R-03): дыра «прокси не описан в Proxy__TrustedCidrs»
/// не выглядит как поломка. Приложение стартует, отдаёт 200, health-check зелёный —
/// просто все лимиты начинают делить одну корзину на всю бету, а HSTS и Scheme=https
/// не доезжают до клиента. Именно поэтому её пропустили: ни в одном артефакте
/// деплоя переменной не было, и молчал не только транспорт, но и журнал.
///
/// Страховка — явный WARNING на старте, читаемый текстом, который нельзя
/// перепутать с фоном.
/// </summary>
public class BareProxyWarningTests
{
    private sealed class ListLogger : ILogger
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Entries.Add((logLevel, formatter(state, exception)));
    }

    private static IConfiguration ConfigWith(string? trustedCidrs) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Proxy:TrustedCidrs"] = trustedCidrs })
            .Build();

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void EmptyTrustedCidrs_WarnsInLogs(string? trustedCidrs)
    {
        var logger = new ListLogger();

        BareProxyGuard.WarnIfBareProxy(ConfigWith(trustedCidrs), logger, ipPartitioningEnabled: true);

        var warning = Assert.Single(logger.Entries, e => e.Level == LogLevel.Warning);
        // Текст, который нельзя прочитать как «что-то про конфиг»: он называет
        // последствие для живого трафика
        Assert.Contains("лимиты партицируются по IP прокси: один клиент блокирует всех", warning.Message);
        Assert.Contains("Proxy__TrustedCidrs", warning.Message);
    }

    [Fact]
    public void ConfiguredTrustedCidrs_StaysSilent()
    {
        var logger = new ListLogger();

        BareProxyGuard.WarnIfBareProxy(ConfigWith("10.0.0.0/24, 203.0.113.5"), logger, ipPartitioningEnabled: true);

        Assert.Empty(logger.Entries);
    }

    [Fact]
    public void WithoutIpPartitioning_StaysSilent()
    {
        var logger = new ListLogger();

        BareProxyGuard.WarnIfBareProxy(ConfigWith(null), logger, ipPartitioningEnabled: false);

        Assert.Empty(logger.Entries);
    }

    [Fact]
    public void CurrentPolicies_AreIpPartitioned_SoTheGuardWouldFireOnBareConfig()
    {
        // Это не заглушка true: зависимость от адреса пира определяется прогоном
        // самих партиций на двух разных IP. Появится новый лимитер по IP —
        // он попадёт в ответ сам, без списка, который кто-то забыл обновить.
        Assert.True(RateLimitPolicies.AnyPartitionDependsOnClientIp());
    }

    [Fact]
    public void GuardIsDrivenByTheSameProbeAsThePolicies()
    {
        var logger = new ListLogger();

        // Пустой Proxy__TrustedCidrs + реальная конфигурация лимитов = предупреждение
        BareProxyGuard.WarnIfBareProxy(ConfigWith(""), logger, RateLimitPolicies.AnyPartitionDependsOnClientIp());

        Assert.NotEmpty(logger.Entries);
    }
}

/// <summary>
/// Партиции должны определять IP-зависимость честно: лимитер, ключ которого
/// не зависит от адреса пира, не должен поднимать ложную тревогу.
/// </summary>
public class IpPartitionProbeTests
{
    [Fact]
    public void SameKeyForEveryIp_IsNotConsideredIpPartitioned()
    {
        Assert.False(RateLimitPolicies.PartitionsDependOnIp(
            new Func<HttpContext, RateLimitPartition<string>>[] { _ => RateLimitPartition.GetFixedWindowLimiter("constant", _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }) }));
    }

    [Fact]
    public void DifferentKeyPerIp_IsConsideredIpPartitioned()
    {
        Assert.True(RateLimitPolicies.PartitionsDependOnIp(
            new Func<HttpContext, RateLimitPartition<string>>[] { ctx => RateLimitPartition.GetFixedWindowLimiter(RateLimitPartitionKeys.IpOnly(ctx), _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }) }));
    }
}
