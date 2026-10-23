using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

public record LeagueTierDto(string Code, string Title);

public record LeagueEntryDto(
    int Rank,
    string Name,
    int WeeklyXp,
    int Level,
    string LevelTitle,
    string? CefrLevel,
    bool IsMe,
    string Zone);

public record LeagueGroupDto(
    string League,
    string LeagueTitle,
    int Index,
    int Participants,
    int SizeLimit,
    int PromotionSpots,
    int DemotionSpots,
    bool Forming,
    bool PromotionAvailable,
    bool DemotionAvailable,
    string? PromotionLeagueTitle,
    string? DemotionLeagueTitle);

public record LeagueMeDto(
    int? Rank,
    int WeeklyXp,
    string League,
    string LeagueTitle,
    int Level,
    string LevelTitle,
    int Participants,
    string? Zone);

public record LeagueHistoryDto(
    string League,
    string LeagueTitle,
    string NextLeagueTitle,
    int Rank,
    int Participants,
    int WeeklyXp,
    string WeekStart,
    string WeekEnd,
    string Outcome);

public record LeaderboardDto(
    string WeekStart,
    string WeekEnd,
    string WeekEndsAt,
    IReadOnlyList<LeagueTierDto> Leagues,
    LeagueGroupDto Group,
    LeagueMeDto Me,
    IReadOnlyList<LeagueEntryDto> Entries,
    IReadOnlyList<LeagueHistoryDto> History,
    IReadOnlyList<ActivityService.XpRule> XpRules);

/// <summary>
/// Лига недели v2: реальные группы до 30 участников внутри лиги, топ-5 и низ-5
/// меняют лигу при закрытии недели. Группа собирается по недельному XP, поэтому
/// не приходится хранить составы; история и переходы фиксируются в БД.
/// </summary>
public class LeagueService
{
    public const int GroupSize = 30;
    public const int PromotionSpots = 5;
    public const int DemotionSpots = 5;
    public const int MinimumCompetitiveGroup = 10;

    private static readonly SemaphoreSlim WeekGate = new(1, 1);
    private sealed record ActiveRow(string UserId, int Xp);
    private readonly ApplicationDbContext _context;

    public LeagueService(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<LeaderboardDto> GetLeaderboardAsync(string userId)
    {
        await EnsureWeeksProcessedAsync();

        var currentWeek = WeekStart(DateTime.UtcNow);
        var weeklyTotals = await _context.XpEvents.AsNoTracking()
            .Where(e => e.CreatedAt >= currentWeek && e.CreatedAt < currentWeek.AddDays(7) && e.Xp > 0)
            .GroupBy(e => e.UserId)
            .Select(g => new { UserId = g.Key, Xp = g.Sum(x => x.Xp) })
            .ToListAsync();

        var relevantIds = weeklyTotals.Select(t => t.UserId).Append(userId).Distinct().ToList();
        var users = await _context.Users.AsNoTracking()
            .Where(u => relevantIds.Contains(u.Id))
            .Select(u => new
            {
                u.Id,
                u.DisplayName,
                u.Email,
                u.TotalXp,
                u.CefrLevel,
                u.League
            })
            .ToListAsync();
        var userById = users.ToDictionary(u => u.Id);

        var byLeague = weeklyTotals
            .Where(t => userById.ContainsKey(t.UserId))
            .GroupBy(t => LeagueCatalog.ResolveCode(userById[t.UserId].League).Code)
            .ToDictionary(
                g => g.Key,
                g => g
                    .Select(t => new ActiveRow(t.UserId, t.Xp))
                    .OrderByDescending(t => t.Xp)
                    .ThenBy(t => t.UserId, StringComparer.Ordinal)
                    .ToList());

        var myUser = userById.GetValueOrDefault(userId);
        var myLeague = LeagueCatalog.ResolveCode(myUser?.League);
        var ordered = byLeague.GetValueOrDefault(myLeague.Code) ?? new List<ActiveRow>();
        var myIndex = ordered.FindIndex(t => t.UserId == userId);
        var groupIndex = myIndex >= 0 ? myIndex / GroupSize : 0;
        var groupRows = ordered.Skip(groupIndex * GroupSize).Take(GroupSize).ToList();

        var participants = groupRows.Count;
        var forming = participants < MinimumCompetitiveGroup;
        var nextLeague = LeagueCatalog.Next(myLeague.Code);
        var previousLeague = LeagueCatalog.Previous(myLeague.Code);
        var promotionAvailable = nextLeague != null;
        var demotionAvailable = previousLeague != null;

        var entries = groupRows.Select((row, index) =>
        {
            var rank = index + 1;
            var rowUser = userById[row.UserId];
            var (level, _) = XpLevels.Resolve(rowUser.TotalXp);
            var zone = ZoneFor(rank, participants, forming, promotionAvailable, demotionAvailable);
            return new LeagueEntryDto(
                rank,
                DisplayNameOf(rowUser.DisplayName, rowUser.Email),
                row.Xp,
                level.Level,
                level.Title,
                rowUser.CefrLevel,
                row.UserId == userId,
                zone);
        }).ToList();

        var myEntry = entries.FirstOrDefault(e => e.IsMe);
        var myTotal = weeklyTotals.FirstOrDefault(t => t.UserId == userId);
        var (myLevel, _) = XpLevels.Resolve(myUser?.TotalXp ?? 0);

        var history = await _context.LeagueHistories.AsNoTracking()
            .Where(h => h.UserId == userId)
            .OrderByDescending(h => h.WeekStart)
            .Take(8)
            .ToListAsync();

        return new LeaderboardDto(
            currentWeek.ToString("yyyy-MM-dd"),
            currentWeek.AddDays(6).ToString("yyyy-MM-dd"),
            currentWeek.AddDays(7).ToString("o"),
            LeagueCatalog.All.Select(l => new LeagueTierDto(l.Code, l.Title)).ToList(),
            new LeagueGroupDto(
                myLeague.Code,
                myLeague.Title,
                groupIndex + 1,
                participants,
                GroupSize,
                PromotionSpots,
                DemotionSpots,
                forming,
                promotionAvailable,
                demotionAvailable,
                nextLeague?.Title,
                previousLeague?.Title),
            new LeagueMeDto(
                myEntry?.Rank,
                myTotal?.Xp ?? 0,
                myLeague.Code,
                myLeague.Title,
                myLevel.Level,
                myLevel.Title,
                participants,
                myEntry?.Zone ?? (forming ? "forming" : null)),
            entries,
            history.Select(h =>
            {
                var league = LeagueCatalog.ResolveCode(h.League);
                var next = LeagueCatalog.ResolveCode(h.NextLeague);
                return new LeagueHistoryDto(
                    league.Code,
                    league.Title,
                    next.Title,
                    h.Rank,
                    h.Participants,
                    h.WeeklyXp,
                    h.WeekStart.ToString("yyyy-MM-dd"),
                    h.WeekStart.AddDays(6).ToString("yyyy-MM-dd"),
                    h.Outcome);
            }).ToList(),
            ActivityService.Rules);
    }

    private static string ZoneFor(
        int rank,
        int participants,
        bool forming,
        bool promotionAvailable,
        bool demotionAvailable)
    {
        if (forming) return "forming";
        if (promotionAvailable && rank <= PromotionSpots) return "promotion";
        if (demotionAvailable && rank > participants - DemotionSpots) return "demotion";
        return "middle";
    }

    /// <summary>
    /// Закрывает все завершённые недели, которые ещё не были посчитаны.
    /// Первый запуск только ставит точку отсчёта, чтобы не придумывать историю
    /// за недели до появления лиг.
    /// </summary>
    private async Task EnsureWeeksProcessedAsync()
    {
        await WeekGate.WaitAsync();
        try
        {
            var currentWeek = WeekStart(DateTime.UtcNow);
            var state = await _context.LeagueWeekStates.FirstOrDefaultAsync(s => s.Id == 1);
            if (state == null)
            {
                state = new LeagueWeekState
                {
                    Id = 1,
                    LastProcessedWeekStart = currentWeek.AddDays(-7)
                };
                _context.LeagueWeekStates.Add(state);
                await _context.SaveChangesAsync();
                return;
            }

            var lastCompletedWeek = currentWeek.AddDays(-7);
            var week = state.LastProcessedWeekStart.AddDays(7);
            var changed = false;

            while (week <= lastCompletedWeek)
            {
                await ProcessWeekAsync(week);
                state.LastProcessedWeekStart = week;
                changed = true;
                week = week.AddDays(7);
            }

            if (changed)
            {
                await _context.SaveChangesAsync();
            }
        }
        finally
        {
            WeekGate.Release();
        }
    }

    private async Task ProcessWeekAsync(DateTime weekStart)
    {
        // Идемпотентность на случай ручного перезапуска состояния.
        if (await _context.LeagueHistories.AnyAsync(h => h.WeekStart == weekStart))
        {
            return;
        }

        var weekEnd = weekStart.AddDays(7);
        var totals = await _context.XpEvents.AsNoTracking()
            .Where(e => e.CreatedAt >= weekStart && e.CreatedAt < weekEnd && e.Xp > 0)
            .GroupBy(e => e.UserId)
            .Select(g => new { UserId = g.Key, Xp = g.Sum(x => x.Xp) })
            .ToListAsync();

        if (totals.Count == 0) return;

        var ids = totals.Select(t => t.UserId).ToList();
        var users = await _context.Users
            .Where(u => ids.Contains(u.Id))
            .ToListAsync();
        var userById = users.ToDictionary(u => u.Id);

        var groups = totals
            .Where(t => userById.ContainsKey(t.UserId))
            .GroupBy(t => LeagueCatalog.ResolveCode(userById[t.UserId].League).Code);

        var histories = new List<LeagueHistory>();

        foreach (var leagueGroup in groups)
        {
            var currentLeague = LeagueCatalog.ResolveCode(leagueGroup.Key);
            var nextLeague = LeagueCatalog.Next(currentLeague.Code);
            var previousLeague = LeagueCatalog.Previous(currentLeague.Code);

            var ordered = leagueGroup
                .OrderByDescending(t => t.Xp)
                .ThenBy(t => t.UserId, StringComparer.Ordinal)
                .ToList();

            for (var offset = 0; offset < ordered.Count; offset += GroupSize)
            {
                var chunk = ordered.Skip(offset).Take(GroupSize).ToList();
                var participants = chunk.Count;
                var forming = participants < MinimumCompetitiveGroup;

                for (var index = 0; index < chunk.Count; index++)
                {
                    var row = chunk[index];
                    var user = userById[row.UserId];
                    var rank = index + 1;

                    var outcome = "held";
                    var nextCode = currentLeague.Code;

                    if (!forming)
                    {
                        if (rank <= PromotionSpots && nextLeague != null)
                        {
                            outcome = "promoted";
                            nextCode = nextLeague.Code;
                        }
                        else if (rank > participants - DemotionSpots && previousLeague != null)
                        {
                            outcome = "demoted";
                            nextCode = previousLeague.Code;
                        }
                    }
                    else
                    {
                        outcome = "forming";
                    }

                    user.League = nextCode;
                    histories.Add(new LeagueHistory
                    {
                        UserId = user.Id,
                        WeekStart = weekStart,
                        League = currentLeague.Code,
                        Rank = rank,
                        Participants = participants,
                        WeeklyXp = row.Xp,
                        Outcome = outcome,
                        NextLeague = nextCode
                    });
                }
            }
        }

        _context.LeagueHistories.AddRange(histories);
    }

    private static DateTime WeekStart(DateTime utcNow)
    {
        var date = utcNow.Date;
        return date.AddDays(-(((int)date.DayOfWeek + 6) % 7));
    }

    private static string DisplayNameOf(string? displayName, string? email)
    {
        if (!string.IsNullOrWhiteSpace(displayName)) return displayName.Trim();
        if (string.IsNullOrWhiteSpace(email)) return "Ученик";

        var at = email.IndexOf('@');
        return at > 0 ? email[..at] : email;
    }
}
