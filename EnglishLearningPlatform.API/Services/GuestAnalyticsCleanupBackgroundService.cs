namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Фоновый проход чистки гостевых событий (W4.1).
///
/// Стиль тот же, что у ReminderBackgroundService: короткое живое существо
/// процесса, работа — в отдельном сервисе, который можно вызвать и проверить
/// без таймера. Отличие одно и оно принципиальное: первый проход выполняется
/// сразу после старта, а не через интервал.
///
/// Зачем сразу: бесплатный инстанс Render спит между запросами и просыпается
/// на каждом деплое, поэтому «раз в шесть часов» без первого прохода на практике
/// означало бы «никогда» — и таблица чистилась бы только руками. С проходом на
/// старте после рестарта не надо ничего настраивать или догонять вручную.
///
/// База недоступна — не падаем: ошибка пишется в журнал, и следующий цикл
/// пробует снова. Фоновая гигиена не имеет права ронять API, которое читатель
/// использует в эту секунду.
/// </summary>
public class GuestAnalyticsCleanupBackgroundService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    /// <summary>Короткая пауза перед первым проходом: дать Identity/миграциям дозакончить старт.</summary>
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(10);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<GuestAnalyticsCleanupBackgroundService> _logger;

    public GuestAnalyticsCleanupBackgroundService(
        IServiceScopeFactory scopeFactory,
        ILogger<GuestAnalyticsCleanupBackgroundService> logger)
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
                var cleanup = scope.ServiceProvider.GetRequiredService<GuestAnalyticsCleanupService>();
                var deleted = await cleanup.RunOnceAsync(stoppingToken);

                // Только число: хеши IP, сутки и имена событий в журнал не
                // ходят — там им делать нечего.
                if (deleted > 0)
                {
                    _logger.LogInformation("Гостевых событий удалено: {Count}", deleted);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Ошибка в цикле чистки гостевых событий");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
