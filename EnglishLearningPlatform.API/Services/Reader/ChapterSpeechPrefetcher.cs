using System.Collections.Concurrent;

namespace EnglishLearningPlatform.API.Services.Reader;

/// <summary>
/// Фоновый прогрев озвучки главы.
///
/// Зачем: читатель нажимает «Слушать», и первое предложение приходит с
/// 3–6-секундной задержкой, а каждый такой запрос ещё и списывает символы из
/// месячного бюджета платформы (400 000 на всех читателей). Прогрев кладёт файлы
/// в тот же файловый кэш, что и <see cref="AzureSpeechService"/>
/// (<see cref="AzureSpeechService.CacheName"/> детерминирован от текста), поэтому
/// первое прослушивание отдаётся с диска уже бесплатно.
///
/// Три правила, без которых прогрев хуже, чем его отсутствие:
///  - он НЕ блокирует запрос пользователя: <see cref="Start"/> стартует задачу и
///    сразу возвращается, а ошибки уходят в лог, а не в HTTP;
///  - он не жжёт квоту дважды: уже закэшированные предложения пропускаются, а
///    повторный прогрев той же главы ничего не делает;
///  - он не выедает бюджет: не больше <see cref="MaxCharsPerRun"/> символов за
///    заход, и стоп на первом же отказе бюджета.
/// </summary>
public sealed class ChapterSpeechPrefetcher
{
    /// <summary>
    /// Сколько символов прогреваем за один заход. Глава — 60–120 предложений по
    /// ≈100 символов, то есть 6 000–12 000; забирать её целиком нельзя: прогрев
    /// идёт по энтузиазму читателя и не должен сам выедать месячный бюджет
    /// платформы. 3 000 ≈ треть главы — первые 2–3 минуты прослушивания, ровно
    /// тот отрезок, где задержка заметна.
    /// </summary>
    public const int MaxCharsPerRun = 3_000;

    /// <summary>
    /// Больше двух прогревов одновременно — это уже конкуренция за тот же
    /// месячный бюджет и тот же пул HTTP-соединений, что у запросов читателей.
    /// </summary>
    private const int MaxConcurrentRuns = 2;

    // Что уже прогрето в жизни этого процесса: второй прогрев той же главы
    // ничего не делает, даже если файлы не сохранились. Кэш на диске всё равно
    // проверяется по файлам, поэтому перезапуск процесса ничего не ломает.
    private static readonly ConcurrentDictionary<string, byte> Warm = new(StringComparer.Ordinal);
    private static readonly SemaphoreSlim Slots = new(MaxConcurrentRuns, MaxConcurrentRuns);

    private readonly Func<ReaderContentService> _content;
    private readonly Func<AzureSpeechService> _azure;
    private readonly ILogger<ChapterSpeechPrefetcher> _logger;

    /// <summary>
    /// Оба сервиса берутся фабриками, а не экземплярами: прогрев живёт дольше
    /// запроса, и держать в нём DbContext запроса нельзя — он утилизируется
    /// вместе с scope, а фоновая задача продолжает работать.
    /// </summary>
    public ChapterSpeechPrefetcher(
        Func<ReaderContentService> content,
        Func<AzureSpeechService> azure,
        ILogger<ChapterSpeechPrefetcher> logger)
    {
        _content = content;
        _azure = azure;
        _logger = logger;
    }

    /// <summary>
    /// Ставит главу в фоновый прогрев и сразу возвращается. Это и есть смысл:
    /// пользователь получает манифест без ожидания синтеза, а файлы догружаются
    /// к моменту, когда он нажмёт «Слушать».
    /// </summary>
    public void Start(int bookId, string chapterId)
    {
        if (string.IsNullOrWhiteSpace(chapterId))
        {
            return;
        }

        if (!_azure().IsConfigured)
        {
            // Ключа нет — прогревать нечего, клиент всё равно возьмёт браузер.
            return;
        }

        if (!Warm.TryAdd(ChapterKey(bookId, chapterId), 0))
        {
            // Эта глава уже прогрета или прогревается — второй раз не тратим ни
            // символы, ни соединения.
            return;
        }

        _ = Task.Run(async () =>
        {
            try
            {
                await WarmChapterAsync(bookId, chapterId, CancellationToken.None);
            }
            catch (Exception ex)
            {
                // Прогрев — оптимизация: его падение не должно доходить ни до
                // пользователя, ни до процесса.
                _logger.LogWarning(ex, "Прогрев озвучки главы {ChapterId} не удался", chapterId);
            }
        });
    }

    /// <summary>
    /// Прогревает предложения главы по порядку, пока не кончится пачка, бюджет
    /// или сама глава. Возвращает число реально оплаченных символов: повторный
    /// прогрев обязан вернуть 0, и это единственный честный признак того, что
    /// квота не потрачена.
    /// </summary>
    public async Task<int> WarmChapterAsync(
        int bookId,
        string chapterId,
        CancellationToken cancellationToken = default)
    {
        var azure = _azure();
        if (!azure.IsConfigured)
        {
            return 0;
        }

        var snapshot = await _content().EnsureSnapshotAsync(bookId, cancellationToken);
        var chapter = snapshot == null ? null : ReaderContentService.FindChapter(snapshot, chapterId);
        if (chapter == null)
        {
            return 0;
        }

        var sentences = chapter.Blocks
            .SelectMany(block => block.Sentences)
            .Select(sentence => sentence.Text)
            .Where(text => !string.IsNullOrWhiteSpace(text))
            .ToList();

        if (sentences.Count == 0)
        {
            return 0;
        }

        var limit = azure.MonthlyCharLimit;
        var used = await azure.GetUsedCharsAsync(cancellationToken);

        var spent = 0;
        var done = 0;

        await Slots.WaitAsync(cancellationToken);
        try
        {
            foreach (var text in sentences)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var length = AzureSpeechService.MeasureChars(text);
                if (length == 0)
                {
                    continue;
                }

                // Уже в кэше: платить второй раз не за что, и это не ошибка.
                if (azure.GetCachedPath(azure.CacheName(text)) != null)
                {
                    done++;
                    continue;
                }

                if (spent + length > MaxCharsPerRun)
                {
                    // Пачка кончилась — остаток главы догреется следующим заходом.
                    continue;
                }

                if (used + length > limit)
                {
                    // Бюджет кончился: дальше Azure вернёт null на каждое
                    // предложение, и перебор сотни строк был бы пустыми запросами.
                    _logger.LogInformation(
                        "Прогрев озвучки главы {ChapterId}: месячный бюджет исчерпан на {Used} символах",
                        chapterId, used);
                    break;
                }

                var clip = await azure.SynthesizeAsync(text, cancellationToken);
                if (clip == null)
                {
            // Лимит, 429 или отказ провайдера: следующий вызов получит то
                    // же самое, а ждать кулдаун внутри фонового прогрева некому.
                    break;
                }

                spent += length;
                used += length;
                done++;
            }
        }
        finally
        {
            Slots.Release();
        }

        _logger.LogInformation(
            "Прогрев озвучки главы {ChapterId}: потрачено {Spent} символов, в кэше {Done} из {Total}",
            chapterId, spent, done, sentences.Count);

        return spent;
    }

    private static string ChapterKey(int bookId, string chapterId) => $"{bookId}|{chapterId}";
}
