using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Агрегат «как разложен словарь по интервалам повторения» для страницы прогресса.
/// Читает <see cref="UserWord"/> и раскладывает слова по бакетам в памяти:
/// словарь активного пользователя — это тысячи строк, а не миллионы, зато
/// границы бакетов остаются ровно там, где их описывает
/// <see cref="SrsService.CalculateNextReview"/>, а не «примерно как в SQL».
/// </summary>
public class SrsBreakdownService
{
    /// <summary>
    /// Порог «знаю надёжно» — интервал строго больше 21 дня.
    ///
    /// Почему 21: минимальный easeFactor — 1.3, поэтому третье успешное
    /// повторение даёт ≈ 8 дней, четвёртое ≈ 10, пятое ≈ 13, шестое ≈ 17,
    /// седьмое ≈ 23. То есть интервал &gt; 21 дня достижим только после
    /// семи подряд успешных ответов — это и есть «слово держится в памяти»,
    /// а не единичное угадывание. При дефолтном EF 2.5 тот же порог — это
    /// пять ответов подряд (1 → 6 → 15 → 38). Слово вернётся не раньше,
    /// чем через три недели, — значит закреплено.
    /// </summary>
    public const int ReliableIntervalDays = 21;

    private readonly ApplicationDbContext _context;

    public SrsBreakdownService(ApplicationDbContext context)
    {
        _context = context;
    }

    public static string BucketOf(int intervalDays) => intervalDays switch
    {
        < 1 => "learning",
        <= 7 => "short",
        <= 30 => "medium",
        _ => "long"
    };

    public async Task<SrsBreakdownDto> GetAsync(string userId, CancellationToken cancellationToken = default)
    {
        var user = await _context.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);

        // «Завтра» — по часовому поясу пользователя, как и в остальном прогрессе.
        // Без часового пояса (или для неизвестного id) считаем по UTC.
        var zone = UserTime.Resolve(user?.TimeZoneId);
        var now = DateTime.UtcNow;
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(now, zone);
        var tomorrowEndLocal = localNow.Date.AddDays(2);
        var tomorrowEndUtc = TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(tomorrowEndLocal, DateTimeKind.Unspecified), zone);

        var rows = await _context.UserWords.AsNoTracking()
            .Where(uw => uw.UserId == userId)
            .Select(uw => new
            {
                uw.Interval,
                uw.Lapses,
                uw.NextReviewDate
            })
            .ToListAsync(cancellationToken);

        var dto = new SrsBreakdownDto
        {
            Buckets = new Dictionary<string, int>
            {
                ["learning"] = 0,
                ["short"] = 0,
                ["medium"] = 0,
                ["long"] = 0
            },
            ReliableIntervalDays = ReliableIntervalDays
        };

        foreach (var row in rows)
        {
            dto.TotalWords++;
            dto.Buckets[BucketOf(row.Interval)]++;

            if (row.Interval > ReliableIntervalDays) dto.ReliableCount++;

            // Leech — свойство срывов, а не интервала: слово с RepetitionCount,
            // сброшенным до 0, всё равно остаётся леечем.
            if (row.Lapses >= SrsService.LeechThreshold) dto.Leech++;

            if (row.NextReviewDate == null)
            {
                // Без срока слово ждёт первого повторения («новое») — в прогнозы
                // на сегодня/завтра оно не попадает: оно показывается по лимиту новых.
                continue;
            }

            var dueAt = DateTime.SpecifyKind(row.NextReviewDate.Value, DateTimeKind.Utc);
            if (dueAt <= now) dto.DueToday++;
            else if (dueAt < tomorrowEndUtc) dto.DueTomorrow++;
        }

        dto.Learning = dto.Buckets["learning"];
        dto.Short = dto.Buckets["short"];
        dto.Medium = dto.Buckets["medium"];
        dto.Long = dto.Buckets["long"];

        return dto;
    }
}
