namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Раз в 15 минут проверяет, кому пора отправить напоминание.
/// Тяжёлую работу делает ReminderService: он учитывает часовой пояс,
/// ReminderHour и то, не отправляли ли уже сегодня.
/// </summary>
public class ReminderBackgroundService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(20);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ReminderBackgroundService> _logger;

    public ReminderBackgroundService(
        IServiceScopeFactory scopeFactory,
        ILogger<ReminderBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(StartupDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var timer = new PeriodicTimer(Interval);

        do
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var reminders = scope.ServiceProvider.GetRequiredService<ReminderService>();
                var sent = await reminders.RunScheduledAsync(stoppingToken);

                if (sent > 0)
                {
                    _logger.LogInformation("Напоминаний отправлено: {Count}", sent);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Ошибка в цикле напоминаний");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
