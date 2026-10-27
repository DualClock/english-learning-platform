using EnglishLearningPlatform.API.Data;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services.News;

/// <summary>
/// Уборка новостей старше срока хранения.
///
/// Новость — текучка, а не контент: материал трёхмесячной давности никому не
/// нужен, и в отличие от статьи его не жалко. Без уборки таблица растёт
/// линейно с числом источников × интервал опроса, и через год публичная выдача
/// начинает сортировать то, что читатель всё равно никогда не откроет.
///
/// Что удаляется: строки с PublishedAt строго раньше (сейчас − RetentionDays).
/// Граница по PublishedAt, а не по FetchedAt: читателю важно, когда материал
/// вышел у источника, а не когда мы его заметили. Скрытая админом новость
/// удаляется наравне с остальными — скрытие это «не показывать», а не
/// «хранить вечно».
///
/// Пачками, как и GuestAnalyticsCleanupService: один DELETE на раздутой таблице
/// держит блокировку столько, сколько длится проход, а на бесплатном инстансе
/// это легко превращается в отвалившийся health-check.
/// </summary>
public class NewsCleanupService
{
    /// <summary>Срок хранения новостей по умолчанию, если конфиг молчит или врёт.</summary>
    public const int DefaultRetentionDays = 120;

    /// <summary>Строк за один DELETE.</summary>
    public const int BatchSize = 500;

    private readonly ApplicationDbContext _context;
    private readonly ILogger<NewsCleanupService> _logger;

    /// <summary>
    /// Срок хранения. Передаётся числом извне, потому что фоновый сервис уже
    /// разобрал конфиг (и его разбор покрыт тестом), а тестам удобно задать
    /// порог напрямую, не собирая IConfiguration.
    /// </summary>
    public NewsCleanupService(
        ApplicationDbContext context,
        ILogger<NewsCleanupService> logger,
        int retentionDays = DefaultRetentionDays)
    {
        _context = context;
        _logger = logger;

        // Ноль и отрицательное — это «удалить всё», а не «выключить уборку».
        // Такой конфиг явно ошибочен, значит берём дефолт и пишем в журнал:
        // молчаливая чистка всей ленты хуже, чем лишний месяц хранения.
        if (retentionDays > 0)
        {
            RetentionDays = retentionDays;
        }
        else
        {
            RetentionDays = DefaultRetentionDays;
            _logger.LogWarning(
                "News:RetentionDays={Value} некорректен — беру {Default} дней",
                retentionDays, DefaultRetentionDays);
        }
    }

    /// <summary>Фактически применённый порог — нужен журналу и тестам.</summary>
    public int RetentionDays { get; }

    /// <summary>
    /// Один проход уборки. Возвращает число удалённых строк — единственное,
    /// что уходит в журнал.
    /// </summary>
    public async Task<int> RunOnceAsync(CancellationToken cancellationToken = default)
    {
        // PublishedAt хранится в UTC; cutoff считаем от UTC, иначе на смещённой
        // машине порог уезжает на часы и граница становится невоспроизводимой.
        var cutoff = DateTime.UtcNow.AddDays(-RetentionDays);
        var deleted = 0;

        while (true)
        {
            var batch = await _context.NewsItems
                .Where(n => n.PublishedAt < cutoff)
                .OrderBy(n => n.PublishedAt)
                .ThenBy(n => n.Id)
                .Take(BatchSize)
                .ToListAsync(cancellationToken);

            if (batch.Count == 0) break;

            _context.NewsItems.RemoveRange(batch);
            await _context.SaveChangesAsync(cancellationToken);

            deleted += batch.Count;

            // Неполная пачка — значит хвоста не осталось.
            if (batch.Count < BatchSize) break;
        }

        if (deleted > 0)
        {
            _logger.LogInformation(
                "Уборка новостей: удалено {Count} старше {Days} дней (до {Cutoff:u})",
                deleted, RetentionDays, cutoff);
        }

        return deleted;
    }
}
