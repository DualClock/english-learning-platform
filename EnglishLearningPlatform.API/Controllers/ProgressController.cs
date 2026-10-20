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

    public ProgressController(ApplicationDbContext context, AchievementService achievements)
    {
        _context = context;
        _achievements = achievements;
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

    // GET: api/progress/leaderboard — лига недели: сумма XP за текущую неделю
    // (с понедельника UTC) по всем пользователям, топ-20 + своя позиция
    [HttpGet("leaderboard")]
    public async Task<IActionResult> GetLeaderboard()
    {
        var userId = GetUserId();
        var today = DateTime.UtcNow.Date;
        // Понедельник = 0: DayOfWeek начинается с воскресенья
        var weekStart = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));

        var totals = await _context.XpEvents.AsNoTracking()
            .Where(e => e.CreatedAt >= weekStart && e.Xp > 0)
            .GroupBy(e => e.UserId)
            .Select(g => new { UserId = g.Key, Xp = g.Sum(x => x.Xp) })
            .ToListAsync();

        var ranked = totals
            .OrderByDescending(t => t.Xp)
            .ThenBy(t => t.UserId, StringComparer.Ordinal)
            .ToList();

        // Имена нужны только тем, кто попал в топ-20, и самому вызывающему
        var topIds = ranked.Take(LeaderboardTopSize).Select(t => t.UserId).ToList();
        if (!topIds.Contains(userId))
        {
            topIds.Add(userId);
        }

        var users = await _context.Users.AsNoTracking()
            .Where(u => topIds.Contains(u.Id))
            .Select(u => new { u.Id, u.DisplayName, u.Email, u.TotalXp, u.CefrLevel })
            .ToListAsync();

        var userById = users.ToDictionary(u => u.Id);

        var entries = ranked
            .Take(LeaderboardTopSize)
            .Select((row, index) =>
            {
                userById.TryGetValue(row.UserId, out var user);
                var (league, _) = LeagueCatalog.Resolve(row.Xp);
                var (level, _) = XpLevels.Resolve(user?.TotalXp ?? 0);

                return new
                {
                    rank = index + 1,
                    name = DisplayNameOf(user?.DisplayName, user?.Email),
                    weeklyXp = row.Xp,
                    league = league.Code,
                    leagueTitle = league.Title,
                    level = level.Level,
                    levelTitle = level.Title,
                    cefrLevel = user?.CefrLevel,
                    isMe = row.UserId == userId
                };
            })
            .ToList();

        var myIndex = ranked.FindIndex(t => t.UserId == userId);
        var myWeeklyXp = myIndex >= 0 ? ranked[myIndex].Xp : 0;
        var (myLeague, nextLeague) = LeagueCatalog.Resolve(myWeeklyXp);

        userById.TryGetValue(userId, out var me);
        var (myLevel, _) = XpLevels.Resolve(me?.TotalXp ?? 0);

        return Ok(new
        {
            weekStart = weekStart.ToString("yyyy-MM-dd"),
            weekEnd = weekStart.AddDays(6).ToString("yyyy-MM-dd"),
            participants = ranked.Count,
            leagues = LeagueCatalog.All.Select(l => new
            {
                code = l.Code,
                title = l.Title,
                minXp = l.MinXp
            }),
            me = new
            {
                // Позиция не определена, пока за неделю нет XP
                rank = myIndex >= 0 ? myIndex + 1 : (int?)null,
                weeklyXp = myWeeklyXp,
                league = myLeague.Code,
                leagueTitle = myLeague.Title,
                nextLeagueXp = nextLeague?.MinXp,
                nextLeagueTitle = nextLeague?.Title,
                xpToNextLeague = nextLeague == null ? (int?)null : nextLeague.MinXp - myWeeklyXp,
                level = myLevel.Level,
                levelTitle = myLevel.Title,
                inTop = myIndex >= 0 && myIndex < LeaderboardTopSize
            },
            entries
        });
    }

    // Имя в публичном рейтинге: displayName, иначе префикс почты —
    // полный адрес других пользователей не показываем
    private static string DisplayNameOf(string? displayName, string? email)
    {
        if (!string.IsNullOrWhiteSpace(displayName)) return displayName.Trim();
        if (string.IsNullOrWhiteSpace(email)) return "Ученик";

        var at = email.IndexOf('@');
        return at > 0 ? email[..at] : email;
    }

    private const int LeaderboardTopSize = 20;

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
}
