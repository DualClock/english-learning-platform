using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

public class ActivityService
{
    private const int DailyMinutesCap = 60;
    private const int StreakScanLimit = 400;

    private readonly ApplicationDbContext _context;

    public ActivityService(ApplicationDbContext context)
    {
        _context = context;
    }

    /// <summary>
    /// Трекает активность пользователя за сегодня (UTC), начисляет XP и пересчитывает стрик.
    /// kind: read_page, review_word, quiz_done, goal_met
    /// </summary>
    public async Task TrackAsync(string userId, string kind, int amount = 1)
    {
        var today = DateTime.UtcNow.Date;

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
                return; // неизвестный вид активности
        }

        if (xp > 0)
        {
            await AddXpAsync(userId, xp, reason);
        }

        // Пересчёт выполнения дневной цели
        var user = await _context.Users.FirstAsync(u => u.Id == userId);
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
    /// Идемпотентный пересчёт CurrentStreak сканом назад от сегодня по дням с GoalMet.
    /// </summary>
    private async Task RecalculateStreakAsync(string userId, DateTime today)
    {
        var goalDates = await _context.DailyActivities
            .Where(a => a.UserId == userId && a.GoalMet)
            .Select(a => a.Date)
            .ToListAsync();

        var goalSet = goalDates.Select(d => d.Date).ToHashSet();

        var streak = 0;
        if (goalSet.Contains(today))
        {
            var cursor = today;
            while (goalSet.Contains(cursor) && streak < StreakScanLimit)
            {
                streak++;
                cursor = cursor.AddDays(-1);
            }
        }

        await _context.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.CurrentStreak, streak)
                .SetProperty(u => u.LongestStreak, u => u.LongestStreak > streak ? u.LongestStreak : streak)
                .SetProperty(u => u.LastActivityDate, today));
    }
}
