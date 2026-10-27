namespace EnglishLearningPlatform.API.Services.News;

/// <summary>
/// Фоновый цикл синхронизации новостей.
///
/// Стиль тот же, что у ReminderBackgroundService: короткое живое существо
/// процесса, работа — в отдельном сервисе (NewsFetchService), который можно
/// вызвать и проверить без таймера. Это важно, потому что кнопка «Обновить
/// сейчас» в админке вызывает ровно его, а не этот класс.
///
/// Что решается здесь и только здесь:
///
///  1. Интервал и стартовая пауза — из конфига (News:FetchIntervalHours,
///     News:InitialDelayMinutes). Без первого прохода на бесплатном инстансе,
///     который спит между запросами, «раз в два часа» означало бы «никогда».
///
///  2. Ошибка любого рода — журнал и продолжение цикла. Фоновый опрос чужого
///     сайта обязан падать; если он заодно роняет хост, читатель остаётся без
///     API из-за таймаута RSS-ленты. Поэтому ловим всё, кроме отмены.
///
///  3. Уборка идёт в том же проходе, после опроса. Отдельный таймер удвоил бы
///     и код, и окно, в котором новости двух разных проходов живут в разных
///     состояниях.
/// </summary>
public class NewsFetchBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly NewsOptions _options;
    private readonly ILogger<NewsFetchBackgroundService> _logger;

    public NewsFetchBackgroundService(
        IServiceScopeFactory scopeFactory,
        NewsOptions options,
        ILogger<NewsFetchBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _options = options;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            // Явно пишем в журнал: иначе выключенный опрос выглядит как
            // сломавшийся, и его начинают искать в коде.
            _logger.LogInformation("Опрос новостей выключен конфигурацией (News:Enabled=false)");
            return;
        }

        try
        {
            await Task.Delay(_options.InitialDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var timer = new PeriodicTimer(_options.FetchInterval);

        do
        {
            await RunCycleAsync(stoppingToken);
        }
        while (!stoppingToken.IsCancellationRequested
               && await WaitForNextTickAsync(timer, stoppingToken));
    }

    /// <summary>
    /// Один проход: опрос всех источников, затем уборка.
    ///
    /// Отдельный метод (а не тело do-while), чтобы проход можно было вызвать
    /// в тесте и чтобы цикл остался читаемым.
    /// </summary>
    public async Task RunCycleAsync(CancellationToken ct = default)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var provider = scope.ServiceProvider;

            var fetcher = provider.GetRequiredService<NewsFetchService>();
            var report = await fetcher.FetchAllAsync(ct);

            if (report.Added > 0 || report.Updated > 0 || report.Failures.Count > 0)
            {
                _logger.LogInformation(
                    "Проход новостей: добавлено {Added}, обновлено {Updated}, сбоев {Failures}",
                    report.Added, report.Updated, report.Failures.Count);
            }

            var cleanup = provider.GetRequiredService<NewsCleanupService>();
            var deleted = await cleanup.RunOnceAsync(ct);

            if (deleted > 0)
            {
                _logger.LogInformation("Уборка новостей удалила {Count} строк", deleted);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Остановка хоста — не ошибка, жаловаться не на что.
            throw;
        }
        catch (Exception ex)
        {
            // Ни один источник, ни одна строка не имеет права остановить цикл:
            // следующий проход через два часа попробует снова.
            _logger.LogError(ex, "Ошибка в цикле синхронизации новостей — продолжаю по интервалу");
        }
    }

    private static async Task<bool> WaitForNextTickAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
