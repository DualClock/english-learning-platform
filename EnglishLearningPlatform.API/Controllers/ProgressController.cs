using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
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

    public ProgressController(ApplicationDbContext context)
    {
        _context = context;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // GET: api/progress/streak
    [HttpGet("streak")]
    public async Task<IActionResult> GetStreak()
    {
        var userId = GetUserId();
        var today = DateTime.UtcNow.Date;

        var user = await _context.Users.AsNoTracking()
            .FirstAsync(u => u.Id == userId);

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
