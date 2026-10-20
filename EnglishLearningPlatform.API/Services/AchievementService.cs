using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

public record AchievementProgressDto(
    string Code,
    string Title,
    string Description,
    string Icon,
    bool Unlocked,
    DateTime? UnlockedAt,
    int Progress,
    int Target);

public record UserMetricsDto(
    int Words,
    int Reviews,
    int Books,
    int Pages,
    int GrammarUnits,
    int CategoriesLearned,
    int ActiveDays,
    int Streak,
    int Xp);

public record UserProgressDto(
    int Xp,
    int Level,
    string LevelTitle,
    int LevelStartXp,
    int? NextLevelXp,
    int? XpToNextLevel,
    int LevelProgressPercent,
    UserMetricsDto Metrics,
    List<AchievementProgressDto> Achievements,
    int UnlockedCount);

/// <summary>
/// Считает метрики пользователя, разблокирует новые достижения (идемпотентно)
/// и отдаёт прогресс по уровням.
/// </summary>
public class AchievementService
{
    private readonly ApplicationDbContext _context;

    public AchievementService(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<UserProgressDto> GetProgressAsync(string userId)
    {
        var user = await _context.Users.AsNoTracking().FirstAsync(u => u.Id == userId);

        var metrics = await LoadMetricsAsync(userId, user);

        var unlocked = await _context.UserAchievements
            .Where(a => a.UserId == userId)
            .ToListAsync();

        var unlockedCodes = unlocked.Select(a => a.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var newlyUnlocked = new List<UserAchievement>();
        foreach (var def in AchievementCatalog.All)
        {
            if (unlockedCodes.Contains(def.Code)) continue;
            if (MetricValue(def.Metric, metrics) < def.Target) continue;

            var row = new UserAchievement
            {
                UserId = userId,
                Code = def.Code,
                UnlockedAt = DateTime.UtcNow
            };
            newlyUnlocked.Add(row);
            unlocked.Add(row);
            unlockedCodes.Add(def.Code);
        }

        if (newlyUnlocked.Count > 0)
        {
            _context.UserAchievements.AddRange(newlyUnlocked);
            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Гонка двух параллельных запросов: достижение уже записано — не страшно
                _context.ChangeTracker.Clear();
                unlocked = await _context.UserAchievements
                    .Where(a => a.UserId == userId)
                    .ToListAsync();
            }
        }

        var unlockedByCode = unlocked
            .GroupBy(a => a.Code, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.OrderBy(a => a.UnlockedAt).First(), StringComparer.OrdinalIgnoreCase);

        var achievements = AchievementCatalog.All
            .Select(def =>
            {
                var value = MetricValue(def.Metric, metrics);
                unlockedByCode.TryGetValue(def.Code, out var row);
                return new AchievementProgressDto(
                    def.Code,
                    def.Title,
                    def.Description,
                    def.Icon,
                    row != null,
                    row?.UnlockedAt,
                    Math.Min(value, def.Target),
                    def.Target);
            })
            .OrderByDescending(a => a.Unlocked)
            .ThenBy(a => a.Target)
            .ToList();

        var (current, next) = XpLevels.Resolve(user.TotalXp);
        var span = next == null ? 1 : next.MinXp - current.MinXp;
        var into = user.TotalXp - current.MinXp;
        var percent = next == null ? 100 : (int)Math.Round(Math.Clamp((double)into / span, 0, 1) * 100);

        return new UserProgressDto(
            user.TotalXp,
            current.Level,
            current.Title,
            current.MinXp,
            next?.MinXp,
            next == null ? null : next.MinXp - user.TotalXp,
            percent,
            new UserMetricsDto(
                metrics.Words,
                metrics.Reviews,
                metrics.Books,
                metrics.Pages,
                metrics.Grammar,
                metrics.Categories,
                metrics.Days,
                metrics.Streak,
                metrics.Xp),
            achievements,
            achievements.Count(a => a.Unlocked));
    }

    private async Task<Metrics> LoadMetricsAsync(string userId, User user)
    {
        var words = await _context.UserWords.CountAsync(uw => uw.UserId == userId);

        var reviews = await _context.DailyActivities
            .Where(a => a.UserId == userId)
            .SumAsync(a => (int?)a.WordsReviewed) ?? 0;

        var books = await _context.Books.CountAsync(b => b.UploadedByUserId == userId);

        var pages = await _context.Books
            .Where(b => b.UploadedByUserId == userId)
            .Select(b => b.CurrentPage - 1)
            .SumAsync(p => (int?)Math.Max(0, p)) ?? 0;

        var grammar = await _context.UserGrammarProgresses
            .CountAsync(p => p.UserId == userId && p.Score >= 50);

        var categories = await _context.UserCategoryWordProgresses
            .CountAsync(p => p.UserId == userId && p.Status == "learned");

        var days = await _context.DailyActivities
            .CountAsync(a => a.UserId == userId && a.GoalMet);

        return new Metrics(
            Words: words,
            Reviews: reviews,
            Books: books,
            Pages: pages,
            Grammar: grammar,
            Categories: categories,
            Days: days,
            Streak: Math.Max(user.CurrentStreak, user.LongestStreak),
            Xp: user.TotalXp);
    }

    private static int MetricValue(string metric, Metrics m) => metric switch
    {
        "words" => m.Words,
        "reviews" => m.Reviews,
        "books" => m.Books,
        "pages" => m.Pages,
        "grammar" => m.Grammar,
        "categories" => m.Categories,
        "days" => m.Days,
        "streak" => m.Streak,
        "xp" => m.Xp,
        _ => 0
    };

    private record Metrics(
        int Words,
        int Reviews,
        int Books,
        int Pages,
        int Grammar,
        int Categories,
        int Days,
        int Streak,
        int Xp);
}
