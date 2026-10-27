using System.Globalization;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Npgsql;

namespace EnglishLearningPlatform.API.Services.News;

/// <summary>
/// Итог одного прохода синхронизации.
///
/// Отдельный тип, а не три out-параметра: это ровно то, что показывается
/// админу в ответе на «Обновить сейчас» и пишется в журнал. Failures — имена
/// источников, которые не ответили; подробности уже в журнале, наружу идёт
/// только факт, чтобы не отдавать в админку текст чужого исключения.
/// </summary>
public record NewsFetchReport(int Added, int Updated, int Skipped, IReadOnlyList<string> Failures)
{
    public static readonly NewsFetchReport Empty = new(0, 0, 0, Array.Empty<string>());
}

/// <summary>
/// Синхронизация ленты новостей: опрос всех источников, запись новых
/// материалов, освежение уже известных.
///
/// Три решения, которые определяют всю работу сервиса:
///
///  1. Один источник не отменяет остальные. Опрос идёт по каждому источнику
///     в отдельном try/catch: таймаут одного сайта не должен оставить ленту
///     пустой, пока живы четыре других.
///
///  2. Дедупликация — существующая строка, а не новая. Ключ — SHA-256 от
///     канонического URL (<see cref="NewsItemIdempotency"/>). Найденную строку
///     обновляем, но НЕ воскрешаем: скрытая админом новость остаётся скрытой,
///     иначе она возвращалась бы в ленту на каждом двухчасовом проходе.
///
///  3. Уникальный индекс — последняя линия обороны. Между «проверил» и
///     «вставил» помещается второй запуск (кнопка «Обновить сейчас» поверх
///     таймера). Нарушение индекса трактуется как «уже вставлено соседом»:
///     это нормальный исход гонки, а не ошибка, и ронять из-за него проход
///     незачем.
/// </summary>
public class NewsFetchService
{
    /// <summary>
    /// Сколько дней новость остаётся интересной в ленте. Записи старше этого
    /// порога не вставляем: их удалит уборка на следующем проходе, а до тех
    /// пор они займут слот свежести в выдаче.
    /// </summary>
    public const int MaxEntryAgeDays = 60;

    /// <summary>Допустимые уровни CEFR. Колонка на 2 символа — мусор не влезет.</summary>
    private static readonly string[] CefrLevels = { "A1", "A2", "B1", "B2", "C1", "C2" };

    /// <summary>Грубая оценка: тело длиннее этого на карточку не отдаём.</summary>
    private const int MaxHtmlLength = 64 * 1024;

    /// <summary>
    /// Санитайзер тела новости.
    ///
    /// Экземпляр по умолчанию, без HtmlSanitizerOptions, — и это не лень.
    /// Конструктор с настройками заменяет справочники целиком: передав только
    /// AllowedTags/AllowedAttributes, мы обнулили бы AllowedSchemes, и
    /// href="javascript:..." прошёл бы насквозь (проверено на v9.2.1039).
    /// Дефолтный набор уже безопасен и совпадает с тем, что применяет
    /// RssNewsSource: один санитайзер на всю ленту лучше двух разных
    /// представлений о «безопасном HTML».
    ///
    /// Потокобезопасен, пока не меняются наборы, поэтому один на процесс: новый
    /// экземпляр на каждую запись — лишняя сборка внутренних таблиц.
    /// </summary>
    private static readonly Ganss.Xss.HtmlSanitizer BodySanitizer = new();

    private readonly ApplicationDbContext _context;
    private readonly IReadOnlyList<INewsSource> _sources;
    private readonly ILogger<NewsFetchService> _logger;

    public NewsFetchService(
        ApplicationDbContext context,
        IEnumerable<INewsSource> sources,
        ILogger<NewsFetchService> logger)
    {
        _context = context;
        _sources = sources?.ToList() ?? new List<INewsSource>();
        _logger = logger;
    }

    /// <summary>
    /// Один проход по всем источникам. Не бросает: сеть и разбор — регулярно
    /// падающие вещи, а вызывающий — фоновый цикл, которому падение обошлось
    /// бы в остаток дня без обновлений.
    /// </summary>
    public async Task<NewsFetchReport> FetchAllAsync(CancellationToken ct = default)
    {
        var added = 0;
        var updated = 0;
        var skipped = 0;
        var failures = new List<string>();

        foreach (var source in _sources)
        {
            ct.ThrowIfCancellationRequested();

            IReadOnlyList<NewsFeedEntry> entries;
            try
            {
                entries = await source.FetchAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Остановка хоста, а не ошибка источника: прерываем проход.
                throw;
            }
            catch (Exception ex)
            {
                failures.Add(source.Name);
                _logger.LogWarning(ex, "Источник новостей {Source} недоступен — пропускаю", source.Name);
                continue;
            }

            var perSource = await SaveEntriesAsync(source, entries ?? Array.Empty<NewsFeedEntry>(), ct);
            added += perSource.Added;
            updated += perSource.Updated;
            skipped += perSource.Skipped;
        }

        _logger.LogInformation(
            "Синхронизация новостей: добавлено {Added}, обновлено {Updated}, пропущено {Skipped}, сбоев {Failures}",
            added, updated, skipped, failures.Count);

        return new NewsFetchReport(added, updated, skipped, failures);
    }

    /// <summary>
    /// Запись ленты одного источника. Здесь и только здесь решается, что из
    /// ответа фида станет строкой базы.
    /// </summary>
    private async Task<NewsFetchReport> SaveEntriesAsync(
        INewsSource source, IReadOnlyList<NewsFeedEntry> entries, CancellationToken ct)
    {
        var added = 0;
        var updated = 0;
        var skipped = 0;

        // Уже виденные ключи в этом проходе: кривой фид иногда повторяет запись,
        // и второй раз проверять базу незачем.
        var seenInThisRun = new HashSet<string>(StringComparer.Ordinal);

        foreach (var entry in entries)
        {
            ct.ThrowIfCancellationRequested();

            var externalId = NewsItemIdempotency.Hash(entry?.SourceUrl ?? string.Empty);

            // Пустой URL — ни ключа, ни перехода к источнику. Такая запись
            // бесполезна читателю.
            if (string.IsNullOrWhiteSpace(entry?.SourceUrl)
                || NewsItemIdempotency.Canonicalize(entry.SourceUrl).Length == 0)
            {
                skipped++;
                continue;
            }

            if (!seenInThisRun.Add(externalId))
            {
                skipped++;
                continue;
            }

            // Слишком старая запись не нужна: её либо вычистит уборка, либо
            // она займёт место в ленте, где читатель ждёт свежее.
            if (entry.PublishedAt != default &&
                entry.PublishedAt.ToUniversalTime() < DateTime.UtcNow.AddDays(-MaxEntryAgeDays))
            {
                skipped++;
                continue;
            }

            var existing = await _context.NewsItems
                .FirstOrDefaultAsync(n => n.ExternalId == externalId, ct);

            if (existing != null)
            {
                if (Apply(existing, entry, source))
                {
                    updated++;
                }

                continue;
            }

            var item = new NewsItem { ExternalId = externalId };
            Apply(item, entry, source);
            _context.NewsItems.Add(item);

            try
            {
                await _context.SaveChangesAsync(ct);
                added++;
            }
            catch (DbUpdateException ex) when (IsUniqueViolation(ex))
            {
                // Параллельный запуск вставил эту новость раньше нас. Это
                // ожидаемый исход гонки: отцепляем свою копию, чтобы она не
                // приклеилась к следующему SaveChanges, и идём дальше.
                _context.Entry(item).State = EntityState.Detached;
                skipped++;

                _logger.LogInformation(
                    "Новость {ExternalId} уже вставлена другим запуском — пропускаю", externalId);
            }
        }

        // Найденные ранее строки могли измениться — сохраняем одним запросом.
        if (_context.ChangeTracker.HasChanges())
        {
            try
            {
                await _context.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex, "Не удалось обновить часть новостей источника {Source}", source.Name);
            }
        }

        return new NewsFetchReport(added, updated, skipped, Array.Empty<string>());
    }

    /// <summary>
    /// Переносит данные фида в строку базы. Возвращает true, если что-то
    /// содержательное изменилось, — по этому счётчику считается «обновлено».
    ///
    /// Поля, которых у нас нет права менять: IsHidden (решение админа) и
    /// ExternalId (ключ дедупликации).
    /// </summary>
    private static bool Apply(NewsItem item, NewsFeedEntry entry, INewsSource source)
    {
        var title = Clean(entry.Title, 300);
        var summary = Truncate(Clean(entry.Summary, 1000), 1000);
        var body = SanitizeHtml(entry.BodyHtml);
        var sourceName = Clean(string.IsNullOrWhiteSpace(entry.SourceName) ? source.Name : entry.SourceName, 100);
        var imageUrl = NormalizeUrl(entry.ImageUrl, 500);

        var changed = false;

        if (item.Title != title) { item.Title = title; changed = true; }
        if (item.Summary != summary) { item.Summary = summary; changed = true; }
        if (item.BodyHtml != body) { item.BodyHtml = body; changed = true; }
        if (item.SourceName != sourceName) { item.SourceName = sourceName; changed = true; }
        if (item.SourceUrl != entry.SourceUrl.Trim()) { item.SourceUrl = entry.SourceUrl.Trim(); changed = true; }
        if (item.ImageUrl != imageUrl) { item.ImageUrl = imageUrl; changed = true; }

        var level = NormalizeLevel(entry.Level);
        if (item.Level != level) { item.Level = level; changed = true; }

        var topics = NormalizeTopics(entry.Topics);
        if (item.Topics != topics) { item.Topics = topics; changed = true; }

        // PublishedAt не перезаписываем при нулевом значении: источник,
        // потерявший дату, не должен «омолодить» старую новость.
        //
        // Сравниваем по тикам, а не через !=: DateTime несёт Kind, и провайдер
        // возвращает из базы Unspecified там, где мы писали Utc. Оператор !=
        // учитывает Kind, поэтому «ничего не изменилось» считалось обновлением
        // на каждом проходе, а отчёт админа показывал работу там, где её нет.
        if (entry.PublishedAt != default && item.PublishedAt.Ticks != entry.PublishedAt.Ticks)
        {
            item.PublishedAt = entry.PublishedAt.ToUniversalTime();
            changed = true;
        }

        if (item.Id != 0) item.FetchedAt = DateTime.UtcNow;

        return changed;
    }

    private static string Clean(string? value, int maxLength)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length <= maxLength ? text : text[..maxLength].TrimEnd();
    }

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];

    /// <summary>
    /// Оставляет только теги без атрибутов и стирает любые скрипты.
    ///
    /// Почему не HtmlSanitizer из пакета: зависимость ради одного вызова в
    /// фоновом сервисе, а формат фида — предсказуемо простой HTML (абзацы,
    /// ссылки, списки). Правило простое и проверяемое: тег без атрибутов,
    /// блоки script/style — целиком, javascript:-ссылки — выбрасываются.
    /// </summary>
    private static string SanitizeHtml(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return string.Empty;

        // Скрипты и встраиваемые объекты — вместе с содержимым, а не только
        // теги: <script>alert(1)</script> без парного тега оставил бы в тексте
        // голый вызов. HtmlSanitizer знает это лучше регулярки.
        var cleaned = BodySanitizer.Sanitize(html);

        return cleaned.Length <= MaxHtmlLength ? cleaned : cleaned[..MaxHtmlLength];
    }

    private static string? NormalizeUrl(string? url, int maxLength)
    {
        var trimmed = (url ?? string.Empty).Trim();
        if (trimmed.Length == 0) return null;
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;

        return trimmed.Length <= maxLength ? trimmed : null;
    }

    /// <summary>
    /// Уровень CEFR в каноническом виде — или null.
    ///
    /// Обрезать «Beginner» до «Be» нельзя: колонка на 2 символа, и обрезка
    /// превратила бы мусор источника в валидный на вид уровень, который попадёт
    /// в персональную выдачу и покажет C1-текст первогодке.
    /// </summary>
    public static string? NormalizeLevel(string? level)
    {
        if (string.IsNullOrWhiteSpace(level)) return null;

        var normalized = level.Trim().ToUpperInvariant();
        return CefrLevels.Contains(normalized, StringComparer.Ordinal) ? normalized : null;
    }

    /// <summary>
    /// Темы — строкой через запятую.
    ///
    /// Источники пишут рубрики по-своему, а фильтр по интересам сравнивает с
    /// ключами справочника. Без нормализации человек с выбранным «Спорт»
    /// видит пустоту при десяти спортивных новостях.
    /// </summary>
    public static string NormalizeTopics(string[]? topics)
    {
        if (topics == null || topics.Length == 0) return Interests.Normalize(null);

        var keys = topics
            .Select(Interests.Normalize)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var joined = string.Join(',', keys);

        // Колонка на 300 символов: справочник маленький, но обрезать безопасно
        // и нужно — иначе INSERT упадёт на длине.
        return joined.Length <= 300 ? joined : joined[..300].TrimEnd(',');
    }

    /// <summary>
    /// Нарушение уникального индекса по ExternalId.
    ///
    /// PostgreSQL отдаёт SqlState 23505; имена индекса и свойства проверяются
    /// отдельно, потому что гонка «проверил → вставил» теоретически может
    /// упереться и в другой уникальный индекс строки. В провайдере InMemory
    /// (тесты) уникальность индексов не проверяется вовсе — там DbUpdateException
    /// этого вида не возникает, и ветка остаётся честно невостребованной.
    /// </summary>
    private static bool IsUniqueViolation(DbUpdateException ex)
    {
        if (ex.InnerException is PostgresException postgres)
        {
            return postgres.SqlState == PostgresErrorCodes.UniqueViolation
                   && (postgres.ConstraintName?.Contains("ExternalId", StringComparison.OrdinalIgnoreCase) ?? false
                       || postgres.MessageText.Contains("ExternalId", StringComparison.OrdinalIgnoreCase));
        }

        // Провайдер без кодов ошибок: опираемся на текст.
        return ex.InnerException?.Message.Contains("ExternalId", StringComparison.OrdinalIgnoreCase) == true;
    }
}
