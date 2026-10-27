using EnglishLearningPlatform.API.Data;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace EnglishLearningPlatform.API.Services;

// Проверка БД для /health:деплой-скрипты должны видеть падение Postgres,
// а не «ok» от живого процесса с мёртвой базой. DbContext — scoped, поэтому
// чек (singleton) открывает свой scope.
public class DatabaseHealthCheck : IHealthCheck
{
    private readonly IServiceScopeFactory _scopeFactory;

    public DatabaseHealthCheck(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var canConnect = await dbContext.Database.CanConnectAsync(cancellationToken);
        return canConnect
            ? HealthCheckResult.Healthy("База данных отвечает")
            : HealthCheckResult.Unhealthy("База данных недоступна");
    }
}
