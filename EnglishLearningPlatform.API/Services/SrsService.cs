using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// SRS: упрощённый SM-2 с learning steps.
///  - «Забыл» → возврат через 10 минут, EF падает, растёт счётчик срывов;
///  - «Трудно/Хорошо/Легко» → 1 день, 6 дней, дальше интервал × EF;
///  - интервал ограничен 365 днями и «размывается» на ±5%, чтобы карточки не липли к одной дате;
///  - после 4 срывов слово помечается leech и не уходит дальше 3 дней.
/// </summary>
public class SrsService
{
    public const int LearningStepMinutes = 10;
    public const int MaxIntervalDays = 365;
    public const int LeechThreshold = 4;
    public const int LeechMaxIntervalDays = 3;

    private const int DefaultReviewLimit = 20;
    private static readonly TimeSpan UndoWindow = TimeSpan.FromMinutes(10);

    private readonly ApplicationDbContext _context;
    private readonly IMemoryCache _cache;

    public SrsService(ApplicationDbContext context, IMemoryCache cache)
    {
        _context = context;
        _cache = cache;
    }

    public record Schedule(
        int IntervalDays,
        int IntervalMinutes,
        double EaseFactor,
        int Repetitions,
        int Lapses,
        bool IsLeech);

    public record ReviewOutcome(
        int IntervalDays,
        int IntervalMinutes,
        DateTime NextReviewDate,
        double EaseFactor,
        int RepetitionCount,
        int Lapses,
        bool IsLeech,
        string UndoToken);

    private sealed record UndoSnapshot(
        int Interval,
        int IntervalMinutes,
        double EaseFactor,
        int RepetitionCount,
        int Lapses,
        bool IsLeech,
        int? LastQuality,
        DateTime? NextReviewDate,
        DateTime? LastReviewedAt,
        DateTime? UpdatedAt);

    private sealed record UndoEntry(
        UndoSnapshot Snapshot,
        DateTime ReviewedAt,
        int Quality);

    public record TodayQueue(
        List<UserWord> DueWords,
        List<UserWord> NewWords,
        int DueCount,
        int NewCount,
        int ReviewLimit,
        int NewLimit);

    public async Task<ReviewOutcome?> ReviewWordAsync(string userId, int wordId, int quality)
    {
        if (quality < 1 || quality > 5)
            return null;

        var userWord = await _context.UserWords
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == wordId);

        if (userWord == null) return null;

        // Снимок для «Отменить»: если человек промахнулся по кнопке,
        // возвращаем ровно то расписание, что было до ответа.
        var snapshot = new UndoSnapshot(
            userWord.Interval,
            userWord.IntervalMinutes,
            userWord.EaseFactor,
            userWord.RepetitionCount,
            userWord.Lapses,
            userWord.IsLeech,
            userWord.LastQuality,
            userWord.NextReviewDate,
            userWord.LastReviewedAt,
            userWord.UpdatedAt);

        var now = DateTime.UtcNow;
        var previousInterval = userWord.Interval;

        var schedule = CalculateNextReview(
            quality,
            userWord.Interval,
            userWord.IntervalMinutes,
            userWord.EaseFactor,
            userWord.RepetitionCount,
            userWord.Lapses);

        var nextReviewDate = schedule.IntervalMinutes > 0
            ? now.AddMinutes(schedule.IntervalMinutes)
            : now.AddDays(schedule.IntervalDays);

        userWord.Interval = schedule.IntervalDays;
        userWord.IntervalMinutes = schedule.IntervalMinutes;
        userWord.EaseFactor = schedule.EaseFactor;
        userWord.RepetitionCount = schedule.Repetitions;
        userWord.Lapses = schedule.Lapses;
        userWord.IsLeech = schedule.IsLeech;
        userWord.LastQuality = quality;
        userWord.NextReviewDate = nextReviewDate;
        userWord.LastReviewedAt = now;
        userWord.UpdatedAt = now;

        _context.ReviewLogs.Add(new ReviewLog
        {
            UserId = userId,
            WordId = wordId,
            Quality = quality,
            PreviousInterval = previousInterval,
            NewInterval = schedule.IntervalDays,
            EaseFactor = schedule.EaseFactor,
            ReviewedAt = now
        });

        await _context.SaveChangesAsync();

        var undoToken = Guid.NewGuid().ToString("N");
        _cache.Set(
            UndoKey(userId, wordId, undoToken),
            new UndoEntry(snapshot, now, quality),
            UndoWindow);

        return new ReviewOutcome(
            schedule.IntervalDays,
            schedule.IntervalMinutes,
            nextReviewDate,
            schedule.EaseFactor,
            schedule.Repetitions,
            schedule.Lapses,
            schedule.IsLeech,
            undoToken);
    }

    /// <summary>
    /// Отменяет последний ответ на слово, если с него прошло не больше 10 минут
    /// и слово не успели пересмотреть снова. Возвращает false, если отменять нечего.
    /// </summary>
    public async Task<bool> UndoReviewAsync(string userId, int wordId, string undoToken)
    {
        if (string.IsNullOrWhiteSpace(undoToken)) return false;
        var key = UndoKey(userId, wordId, undoToken);

        if (!_cache.TryGetValue(key, out UndoEntry? entry) || entry == null)
        {
            return false;
        }

        var userWord = await _context.UserWords
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == wordId);

        if (userWord == null ||
            userWord.LastQuality != entry.Quality ||
            userWord.LastReviewedAt == null ||
            Math.Abs((userWord.LastReviewedAt.Value - entry.ReviewedAt).TotalSeconds) > 2)
        {
            _cache.Remove(key);
            return false;
        }

        var snapshot = entry.Snapshot;
        userWord.Interval = snapshot.Interval;
        userWord.IntervalMinutes = snapshot.IntervalMinutes;
        userWord.EaseFactor = snapshot.EaseFactor;
        userWord.RepetitionCount = snapshot.RepetitionCount;
        userWord.Lapses = snapshot.Lapses;
        userWord.IsLeech = snapshot.IsLeech;
        userWord.LastQuality = snapshot.LastQuality;
        userWord.NextReviewDate = snapshot.NextReviewDate;
        userWord.LastReviewedAt = snapshot.LastReviewedAt;
        userWord.UpdatedAt = snapshot.UpdatedAt;

        // Убираем и запись в истории, иначе статистика сохранит отменённый ответ.
        var log = await _context.ReviewLogs
            .Where(l => l.UserId == userId &&
                        l.WordId == wordId &&
                        l.Quality == entry.Quality &&
                        l.ReviewedAt >= entry.ReviewedAt.AddSeconds(-2) &&
                        l.ReviewedAt <= entry.ReviewedAt.AddSeconds(2))
            .OrderByDescending(l => l.Id)
            .FirstOrDefaultAsync();
        if (log != null) _context.ReviewLogs.Remove(log);

        await _context.SaveChangesAsync();
        _cache.Remove(key);
        return true;
    }

    private static string UndoKey(string userId, int wordId, string undoToken) =>
        $"review-undo:{userId}:{wordId}:{undoToken}";

    /// <summary>
    /// Очередь на сегодня: сначала просроченные повторения, затем новые слова
    /// (не больше дневного лимита пользователя).
    /// </summary>
    public async Task<TodayQueue> GetTodayQueueAsync(string userId, int newLimit, int reviewLimit = DefaultReviewLimit)
    {
        var now = DateTime.UtcNow;
        var reviewLimitClamped = Math.Clamp(reviewLimit, 1, 100);
        var newLimitClamped = Math.Clamp(newLimit, 0, 100);

        // Слово без перевода нельзя проверить в карточке: не тянем его
        // в повторения, пока человек не добавит перевод в словаре.
        var dueQuery = _context.UserWords
            .Where(uw => uw.UserId == userId
                         && uw.LastReviewedAt != null
                         && (uw.NextReviewDate == null || uw.NextReviewDate <= now)
                         && uw.Word.Definitions.Any(d => d.Definition != ""));

        var dueCount = await dueQuery.CountAsync();

        var dueWords = await dueQuery
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .OrderBy(uw => uw.NextReviewDate)
            .Take(reviewLimitClamped)
            .ToListAsync();

        var newQuery = _context.UserWords
            .Where(uw => uw.UserId == userId
                         && uw.LastReviewedAt == null
                         && uw.Word.Definitions.Any(d => d.Definition != ""));

        var newCount = await newQuery.CountAsync();

        var newWords = await newQuery
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .OrderBy(uw => uw.CreatedAt)
            .Take(newLimitClamped)
            .ToListAsync();

        return new TodayQueue(dueWords, newWords, dueCount, newCount, reviewLimitClamped, newLimitClamped);
    }

    public async Task<int> GetReviewCountAsync(string userId)
    {
        return await _context.UserWords
            .CountAsync(uw => uw.UserId == userId
                              && uw.LastReviewedAt != null
                              && (uw.NextReviewDate == null || uw.NextReviewDate <= DateTime.UtcNow)
                              && uw.Word.Definitions.Any(d => d.Definition != ""));
    }

    /// <summary>
    /// Чистая функция расписания — без БД, чтобы её можно было покрыть тестами.
    /// </summary>
    public static Schedule CalculateNextReview(
        int quality,
        int currentInterval,
        int currentIntervalMinutes,
        double currentEaseFactor,
        int currentRepetitions,
        int currentLapses,
        bool applyFuzz = true)
    {
        quality = Math.Clamp(quality, 1, 5);

        // Формула SM-2 применяется и к провалу: слово, которое забывают, должно становиться «тяжелее»
        var easeFactor = Math.Clamp(
            currentEaseFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
            1.3,
            3.0);

        if (quality < 3)
        {
            var lapsesOnFail = currentLapses + 1;
            return new Schedule(
                IntervalDays: 0,
                IntervalMinutes: LearningStepMinutes,
                EaseFactor: easeFactor,
                Repetitions: 0,
                Lapses: lapsesOnFail,
                IsLeech: lapsesOnFail >= LeechThreshold);
        }

        var repetitions = currentRepetitions + 1;

        int intervalDays = repetitions switch
        {
            1 => 1,
            2 => 6,
            _ => (int)Math.Round(Math.Max(currentInterval, 1) * easeFactor)
        };

        if (applyFuzz)
        {
            intervalDays = Fuzz(intervalDays);
        }

        intervalDays = Math.Clamp(intervalDays, 1, MaxIntervalDays);

        var isLeech = currentLapses >= LeechThreshold;
        if (isLeech)
        {
            intervalDays = Math.Min(intervalDays, LeechMaxIntervalDays);
        }

        return new Schedule(
            IntervalDays: intervalDays,
            IntervalMinutes: 0,
            EaseFactor: easeFactor,
            Repetitions: repetitions,
            Lapses: currentLapses,
            IsLeech: isLeech);
    }

    private static int Fuzz(int days)
    {
        if (days <= 2) return days;

        var spread = Math.Max(1, (int)Math.Round(days * 0.05));
        var offset = Random.Shared.Next(-spread, spread + 1);
        return Math.Max(1, days + offset);
    }
}
