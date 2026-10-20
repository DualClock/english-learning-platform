using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

public class ActivityService
{
    private const int DailyMinutesCap = 60;
    private const int StreakScanLimit = 400;

    /// <summary>
    /// XP за практики: сколько даём за одно действие и сколько максимум XP
    /// в день. Кап считается по XpEvents за локальные сутки пользователя,
    /// поэтому его нельзя «перелить» повторными запросами.
    /// </summary>
    private static readonly Dictionary<string, (int UnitXp, int DailyCapXp)> PracticeRewards = new()
    {
        ["category_word"] = (2, 30),        // 15 слов категорий в день
        ["dictation_word"] = (2, 20),       // 10 слов диктанта в день
        ["pronunciation_check"] = (1, 20),  // 20 проверок произношения
        ["alex_message"] = (1, 10),         // 10 реплик с Alex
        ["writing_submitted"] = (5, 15)     // 3 работы в день (по 5 XP)
    };

    private readonly ApplicationDbContext _context;

    public ActivityService(ApplicationDbContext context)
    {
        _context = context;
    }

    /// <summary>
    /// Трекает активность пользователя за сегодня (по его часовому поясу),
    /// начисляет XP и пересчитывает стрик.
    /// kind: read_page, review_word, quiz_done, goal_met,
    /// category_word, dictation_word, pronunciation_check, alex_message, writing_submitted
    /// </summary>
    public async Task TrackAsync(string userId, string kind, int amount = 1)
    {
        var user = await _context.Users.FirstAsync(u => u.Id == userId);
        var today = UserTime.Today(user);

        var activity = await _context.DailyActivities
            .FirstOrDefaultAsync(a => a.UserId == userId && a.Date == today);

        if (activity == null)
        {
            activity = new DailyActivity
            {
                UserId = userId,
                Date = today
            };
            _context.DailyActivities.Add(activity);
        }

        var xp = 0;
        var reason = kind;

        switch (kind)
        {
            case "read_page":
                // По 1 минуте на страницу, кап 60 минут в день
                var minutesToAdd = Math.Max(0, Math.Min(amount, DailyMinutesCap - activity.MinutesRead));
                if (minutesToAdd <= 0) return; // кап достигнут, XP не начисляем
                activity.MinutesRead += minutesToAdd;
                xp = 2 * minutesToAdd;
                break;

            case "review_word":
                activity.WordsReviewed += 1;
                xp = 1;
                break;

            case "quiz_done":
                activity.QuizzesDone += 1;
                xp = 3;
                break;

            default:
                // Практики (диктант, произношение, письмо, Alex, слова категорий)
                // не меняют счётчики дня — только XP с дневным капом
                if (!PracticeRewards.TryGetValue(kind, out var reward))
                {
                    return; // неизвестный вид активности
                }

                var dayStart = UserTime.StartOfDayUtc(user);
                var earnedToday = await _context.XpEvents
                    .Where(e => e.UserId == userId && e.Reason == kind && e.CreatedAt >= dayStart)
                    .SumAsync(e => (int?)e.Xp) ?? 0;

                var remaining = Math.Max(0, reward.DailyCapXp - earnedToday);
                xp = Math.Min(reward.UnitXp * Math.Max(1, amount), remaining);

                if (xp <= 0) return; // кап на сегодня выбран
                break;
        }

        if (xp > 0)
        {
            await AddXpAsync(userId, xp, reason);
        }

        // Пересчёт выполнения дневной цели
        if (!activity.GoalMet &&
            (activity.MinutesRead >= user.DailyGoalMinutes || activity.WordsReviewed >= 10))
        {
            activity.GoalMet = true;
            await AddXpAsync(userId, 5, "daily_goal");
        }

        await _context.SaveChangesAsync();

        await RecalculateStreakAsync(userId, today);
    }

    private async Task AddXpAsync(string userId, int xp, string reason)
    {
        _context.XpEvents.Add(new XpEvent
        {
            UserId = userId,
            Xp = xp,
            Reason = reason
        });

        await _context.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.TotalXp, u => u.TotalXp + xp));
    }

    /// <summary>
    /// Идемпотентный пересчёт CurrentStreak сканом назад по дням с GoalMet.
    /// Если сегодняшняя цель ещё не выполнена — стрик не обнуляем, а считаем
    /// от вчерашнего дня: у пользователя есть время до конца дня.
    /// </summary>
    private async Task RecalculateStreakAsync(string userId, DateTime today)
    {
        var goalDates = await _context.DailyActivities
            .Where(a => a.UserId == userId && a.GoalMet)
            .Select(a => a.Date)
            .ToListAsync();

        var goalSet = goalDates.Select(d => d.Date).ToHashSet();

        var cursor = goalSet.Contains(today) ? today : today.AddDays(-1);

        var streak = 0;
        while (goalSet.Contains(cursor) && streak < StreakScanLimit)
        {
            streak++;
            cursor = cursor.AddDays(-1);
        }

        await _context.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.CurrentStreak, streak)
                .SetProperty(u => u.LongestStreak, u => u.LongestStreak > streak ? u.LongestStreak : streak)
                .SetProperty(u => u.LastActivityDate, today));
    }
}
