using System.Globalization;
using EnglishLearningPlatform.API.Data;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Чистка гостевых событий воронки (W4.1, privacy-гигиена).
///
/// `GuestAnalyticsEvents` росли бы вечно: таблица write-only, а суточный
/// `IpHash` имеет смысл ровно короткое время — «уникальные гости за сутки»
/// считаются по текущим суткам, недельной давности хеш не отвечает ни на один
/// вопрос и только лежит в базе. Мы обещаем гостю на /privacy, что гостевые
/// данные — это не профиль человека; обещание без срока хранения звучит как
/// «пока нам не надоело». Поэтому порог хранится в конфиге, а удаление делает
/// этот сервис.
///
/// Что удаляется: строки с `Day` строго раньше (сегодня − GuestRetentionDays).
/// Граница по суткам, а не по часам, — ровно та granularity, которая лежит в
/// таблице: времени запроса у гостевого события нет (см. Models/GuestAnalyticsEvent).
///
/// Почему батчами: один `DELETE ... WHERE Day < cutoff` на раздутой таблице
/// держит транзакцию и блокирует строки столько, сколько длится проход, а на
/// бесплатном инстансе это легко превращается в таймаут и отвалившийся
/// health-check. Пачка по 1000 строк заканчивается быстро, и между пачками
/// база отдыхает.
///
/// Про `Day < cutoff` и индексы: отдельного индекса по `Day` нет, есть
/// (Event, Day). Для беты с десятками тысяч строк это заведомо быстрее, чем
/// новая миграция «ради одного ночного DELETE», — если таблица когда-нибудь
/// дорастёт до миллионов, индекс добавляется аддитивной миграцией.
/// </summary>
public class GuestAnalyticsCleanupService
{
    /// <summary>Срок хранения гостевых событий по умолчанию, если конфиг молчит или врёт.</summary>
    public const int DefaultRetentionDays = 30;

    /// <summary>Строк за один DELETE. Подобрано под «маленькая база, частый проход».</summary>
    public const int BatchSize = 1000;

    private readonly ApplicationDbContext _context;
    private readonly ILogger<GuestAnalyticsCleanupService> _logger;
    private readonly int _retentionDays;

    public GuestAnalyticsCleanupService(
        ApplicationDbContext context,
        ILogger<GuestAnalyticsCleanupService> logger,
        IConfiguration configuration)
    {
        _context = context;
        _logger = logger;
        _retentionDays = ResolveRetentionDays(configuration["Analytics:GuestRetentionDays"]);
    }

    /// <summary>Фактически применённый порог — нужен тестам и журналу.</summary>
    public int RetentionDays => _retentionDays;

    /// <summary>
    /// Значение из конфига в число дней.
    ///
    /// Не-число, ноль и отрицательное считаются не «выключено», а «некорректно»:
    /// выключенная очистка противоречит обещанию о сроке хранения, а молча
    /// удалённые данные за вчерашний день были бы хуже. Поэтому любой мусор
    /// даёт дефолт, и о нём пишется в журнал.
    /// </summary>
    public static int ResolveRetentionDays(string? raw)
    {
        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) && parsed > 0)
        {
            return parsed;
        }

        return DefaultRetentionDays;
    }

    /// <summary>
    /// Один проход: удаляет всё старше порога, пачками.
    /// Возвращает число удалённых строк — единственное, что уходит в журнал.
    /// </summary>
    public async Task<int> RunOnceAsync(CancellationToken cancellationToken = default)
    {
        var cutoff = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-_retentionDays));
        var deleted = 0;

        while (true)
        {
            var batch = await _context.GuestAnalyticsEvents
                .Where(g => g.Day < cutoff)
                .OrderBy(g => g.Day)
                .ThenBy(g => g.Id)
                .Take(BatchSize)
                .ToListAsync(cancellationToken);

            if (batch.Count == 0) break;

            _context.GuestAnalyticsEvents.RemoveRange(batch);
            await _context.SaveChangesAsync(cancellationToken);

            deleted += batch.Count;

            // Последняя, неполная пачка: следующего запроса не нужно.
            if (batch.Count < BatchSize) break;
        }

        return deleted;
    }
}
