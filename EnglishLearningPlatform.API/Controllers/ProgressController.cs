using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/progress")]
[Authorize]
public class ProgressController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly AchievementService _achievements;
    private readonly LeagueService _league;

    public ProgressController(
        ApplicationDbContext context,
        AchievementService achievements,
        LeagueService league)
    {
        _context = context;
        _achievements = achievements;
        _league = league;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // GET: api/progress/achievements — уровни и достижения
    [HttpGet("achievements")]
    public async Task<IActionResult> GetAchievements()
    {
        var progress = await _achievements.GetProgressAsync(GetUserId());
        return Ok(progress);
    }

    // GET: api/progress/today-plan — «план на сегодня»: повторение, чтение, грамматика
    [HttpGet("today-plan")]
    public async Task<IActionResult> GetTodayPlan()
    {
        var userId = GetUserId();

        var user = await _context.Users.AsNoTracking().FirstAsync(u => u.Id == userId);
        var today = UserTime.Today(user);

        var activity = await _context.DailyActivities.AsNoTracking()
            .FirstOrDefaultAsync(a => a.UserId == userId && a.Date == today);

        var minutesRead = activity?.MinutesRead ?? 0;
        var wordsReviewed = activity?.WordsReviewed ?? 0;

        var dueCount = await _context.UserWords.CountAsync(uw =>
            uw.UserId == userId && (uw.NextReviewDate == null || uw.NextReviewDate <= DateTime.UtcNow));

        var reviewTarget = Math.Min(10, dueCount);
        var reviewCompleted = dueCount == 0 || wordsReviewed >= reviewTarget;

        var book = await _context.Books.AsNoTracking()
            .Where(b => b.UploadedByUserId == userId)
            .OrderByDescending(b => b.Id)
            .Select(b => new
            {
                b.Id,
                b.Title,
                b.CurrentPage,
                b.TotalPages,
                b.Progress,
                b.CoverUrl
            })
            .FirstOrDefaultAsync();

        var completedUnitIds = await _context.UserGrammarProgresses
            .Where(p => p.UserId == userId && p.Score >= 50)
            .Select(p => p.UnitId)
            .ToListAsync();

        var nextUnit = await _context.GrammarUnits.AsNoTracking()
            .Where(u => !completedUnitIds.Contains(u.Id))
            .OrderBy(u => u.Order)
            .Select(u => new { u.Id, u.Title, u.CefrLevel, u.Section })
            .FirstOrDefaultAsync();

        var grammarDoneToday = await _context.UserGrammarProgresses
            .AnyAsync(p => p.UserId == userId && p.CompletedAt >= UserTime.StartOfDayUtc(user));

        var itemsCompleted = 0;
        if (reviewCompleted) itemsCompleted++;
        if (minutesRead > 0) itemsCompleted++;
        if (grammarDoneToday) itemsCompleted++;

        return Ok(new
        {
            date = today.ToString("yyyy-MM-dd"),
            timeZoneId = user.TimeZoneId,
            goal = new
            {
                minutesRead,
                goalMinutes = user.DailyGoalMinutes,
                wordsReviewed,
                goalMet = activity?.GoalMet ?? false
            },
            review = new
            {
                due = dueCount,
                target = reviewTarget,
                done = Math.Min(wordsReviewed, reviewTarget),
                completed = reviewCompleted
            },
            reading = book == null
                ? null
                : new
                {
                    bookId = book.Id,
                    title = book.Title,
                    page = book.CurrentPage,
                    totalPages = book.TotalPages,
                    percent = Math.Round(book.Progress, 1),
                    coverUrl = book.CoverUrl,
                    completed = minutesRead > 0
                },
            grammar = nextUnit == null
                ? null
                : new
                {
                    unitId = nextUnit.Id,
                    title = nextUnit.Title,
                    level = nextUnit.CefrLevel,
                    section = nextUnit.Section,
                    completed = grammarDoneToday
                },
            itemsCompleted,
            itemsTotal = 3
        });
    }

    // GET: api/progress/leaderboard — лига недели v2:
    // реальная группа до 30 участников, зоны повышения/вылета и история.
    [HttpGet("leaderboard")]
    public async Task<IActionResult> GetLeaderboard()
    {
        return Ok(await _league.GetLeaderboardAsync(GetUserId()));
    }

    // GET: api/progress/streak
    [HttpGet("streak")]
    public async Task<IActionResult> GetStreak()
    {
        var userId = GetUserId();

        var user = await _context.Users.AsNoTracking()
            .FirstAsync(u => u.Id == userId);

        // «Сегодня» — по часовому поясу пользователя, а не по UTC
        var today = UserTime.Today(user);

        var todayActivity = await _context.DailyActivities.AsNoTracking()
            .FirstOrDefaultAsync(a => a.UserId == userId && a.Date == today);

        var weekStart = today.AddDays(-6);
        var weekActivities = await _context.DailyActivities.AsNoTracking()
            .Where(a => a.UserId == userId && a.Date >= weekStart)
            .ToListAsync();

        var week = Enumerable.Range(0, 7)
            .Select(i => weekStart.AddDays(i))
            .Select(date =>
            {
                var a = weekActivities.FirstOrDefault(x => x.Date == date);
                return new
                {
                    date = date.ToString("yyyy-MM-dd"),
                    goalMet = a?.GoalMet ?? false,
                    minutesRead = a?.MinutesRead ?? 0
                };
            })
            .ToList();

        return Ok(new
        {
            currentStreak = user.CurrentStreak,
            longestStreak = user.LongestStreak,
            totalXp = user.TotalXp,
            dailyGoalMinutes = user.DailyGoalMinutes,
            timeZoneId = user.TimeZoneId,
            todayDate = today.ToString("yyyy-MM-dd"),
            today = new
            {
                minutesRead = todayActivity?.MinutesRead ?? 0,
                wordsReviewed = todayActivity?.WordsReviewed ?? 0,
                goalMet = todayActivity?.GoalMet ?? false
            },
            week
        });
    }

    // GET: api/progress/activity?days=365 — дневная активность для календаря.
    // Отдаём непрерывный ряд с нулями за пропущенные дни: календарь раскладывает
    // клетки по датам, и «дырка» в ответе сдвинула бы всю сетку.
    [HttpGet("activity")]
    public async Task<IActionResult> GetActivity([FromQuery] int days = 365)
    {
        var userId = GetUserId();

        var user = await _context.Users.AsNoTracking()
            .FirstAsync(u => u.Id == userId);

        var today = UserTime.Today(user);
        var span = Math.Clamp(days, 7, 365);
        var from = today.AddDays(-(span - 1));

        var rows = await _context.DailyActivities.AsNoTracking()
            .Where(a => a.UserId == userId && a.Date >= from && a.Date <= today)
            .Select(a => new { a.Date, a.MinutesRead, a.WordsReviewed, a.GoalMet })
            .ToListAsync();

        // На всякий случай складываем строки за один день: уникальность пары
        // «пользователь + дата» держится кодом, а не ограничением в БД.
        var byDate = rows
            .GroupBy(row => row.Date)
            .ToDictionary(
                group => group.Key,
                group => new
                {
                    Minutes = group.Sum(row => row.MinutesRead),
                    Words = group.Sum(row => row.WordsReviewed),
                    GoalMet = group.Any(row => row.GoalMet)
                });

        var items = new List<object>(span);
        for (var offset = 0; offset < span; offset++)
        {
            var date = from.AddDays(offset);
            byDate.TryGetValue(date, out var row);

            items.Add(new
            {
                date = date.ToString("yyyy-MM-dd"),
                minutes = row?.Minutes ?? 0,
                words = row?.Words ?? 0,
                goalMet = row?.GoalMet ?? false
            });
        }

        return Ok(new
        {
            today = today.ToString("yyyy-MM-dd"),
            days = items
        });
    }
}
