using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

public record ReminderContent(string Subject, string Body, string Kind);

/// <summary>
/// Собирает и отправляет напоминания:
///  - ежедневное «пора повторить / стрик под угрозой / продолжим читать»;
///  - weekly recap по воскресеньям.
/// Проверка расписания — по часовому поясу пользователя и его ReminderHour.
/// </summary>
public class ReminderService
{
    private readonly ApplicationDbContext _context;
    private readonly EmailSender _email;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ReminderService> _logger;

    public ReminderService(
        ApplicationDbContext context,
        EmailSender email,
        IConfiguration configuration,
        ILogger<ReminderService> logger)
    {
        _context = context;
        _email = email;
        _configuration = configuration;
        _logger = logger;
    }

    private string FrontendUrl =>
        (_configuration["App:FrontendUrl"] ?? "http://localhost:3000").TrimEnd('/');

    /// <summary>Проход по всем пользователям: кому сейчас пора напомнить.</summary>
    public async Task<int> RunScheduledAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;

        var users = await _context.Users
            .AsNoTracking()
            .Where(u => u.NotifyEnabled && u.Email != null && u.Email != "")
            .ToListAsync(cancellationToken);

        var sent = 0;

        foreach (var user in users)
        {
            try
            {
                var zone = UserTime.Resolve(user.TimeZoneId);
                var localNow = TimeZoneInfo.ConvertTimeFromUtc(now, zone);

                if (localNow.Hour != user.ReminderHour) continue;

                var weekly = localNow.DayOfWeek == DayOfWeek.Sunday;
                var kind = weekly ? "weekly" : "reminder";
                var dayStartUtc = StartOfLocalDayUtc(user, localNow.Date);

                var alreadySent = await _context.EmailMessages.AnyAsync(
                    m => m.UserId == user.Id && m.Kind == kind && m.CreatedAt >= dayStartUtc,
                    cancellationToken);

                if (alreadySent) continue;

                var content = await BuildAsync(user, localNow, weekly, cancellationToken);
                if (content == null) continue;

                await _email.SendAsync(user.Id, user.Email!, content.Subject, content.Body, content.Kind, cancellationToken);
                sent++;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Не удалось обработать напоминание для {UserId}", user.Id);
            }
        }

        return sent;
    }

    /// <summary>Ручная отправка (кнопка «проверить» в настройках).</summary>
    public async Task<EmailResult> SendTestAsync(User user, CancellationToken cancellationToken = default)
    {
        var zone = UserTime.Resolve(user.TimeZoneId);
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone);

        var content = await BuildAsync(user, localNow, weekly: false, cancellationToken)
            ?? BuildFallback(user);

        return await _email.SendAsync(
            user.Id,
            user.Email ?? string.Empty,
            $"[Тест] {content.Subject}",
            content.Body,
            "test",
            cancellationToken);
    }

    public async Task<ReminderContent?> BuildAsync(
        User user,
        DateTime localNow,
        bool weekly,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var name = string.IsNullOrWhiteSpace(user.DisplayName)
            ? (user.Email ?? "друг").Split('@')[0]
            : user.DisplayName!;

        if (weekly)
        {
            return await BuildWeeklyAsync(user, localNow, name, cancellationToken);
        }

        var dueCount = await _context.UserWords.CountAsync(
            uw => uw.UserId == user.Id
                  && uw.LastReviewedAt != null
                  && (uw.NextReviewDate == null || uw.NextReviewDate <= now),
            cancellationToken);

        var newAvailable = await _context.UserWords.CountAsync(
            uw => uw.UserId == user.Id && uw.LastReviewedAt == null,
            cancellationToken);

        var wordsTotal = await _context.UserWords.CountAsync(uw => uw.UserId == user.Id, cancellationToken);

        var goalMet = await _context.DailyActivities.AnyAsync(
            a => a.UserId == user.Id && a.Date == localNow.Date && a.GoalMet,
            cancellationToken);

        var book = await _context.Books
            .AsNoTracking()
            .Where(b => b.UploadedByUserId == user.Id && b.Progress < 100)
            .OrderByDescending(b => b.Id)
            .Select(b => new { b.Id, b.Title, b.CurrentPage })
            .FirstOrDefaultAsync(cancellationToken);

        // Нечего сказать — не спамим
        if (dueCount == 0 && goalMet && book == null)
            return null;

        string subject;
        if (dueCount > 0)
        {
            subject = $"Пора повторить {dueCount} {Plural(dueCount, "слово", "слова", "слов")}";
        }
        else if (!goalMet && user.CurrentStreak > 0)
        {
            subject = $"Стрик под угрозой — {user.CurrentStreak} {Plural(user.CurrentStreak, "день", "дня", "дней")}";
        }
        else if (book != null)
        {
            subject = $"Продолжим «{book.Title}»?";
        }
        else
        {
            subject = "Пора позаниматься английским";
        }

        var lines = new List<string>
        {
            $"Привет, {name}!",
            ""
        };

        if (dueCount > 0)
        {
            lines.Add($"Сегодня пора повторить {dueCount} {Plural(dueCount, "слово", "слова", "слов")} — на это уйдёт около {Math.Max(2, dueCount / 3)} мин.");
        }
        else if (!goalMet)
        {
            lines.Add("Сегодняшняя цель ещё не выполнена — хватит нескольких минут, чтобы день засчитался.");
        }

        if (newAvailable > 0)
        {
            lines.Add($"Ещё новых слов в очереди: {newAvailable}.");
        }

        lines.Add($"Стрик: {user.CurrentStreak} {Plural(user.CurrentStreak, "день", "дня", "дней")} · слов в словаре: {wordsTotal}.");
        lines.Add("");

        if (book != null)
        {
            lines.Add($"Книга: «{book.Title}», страница {book.CurrentPage}.");
            lines.Add($"Продолжить чтение: {FrontendUrl}/reader/{book.Id}");
        }

        lines.Add($"Повторение: {FrontendUrl}/review");
        lines.Add($"План на сегодня: {FrontendUrl}/dashboard");
        lines.Add("");
        lines.Add($"Отключить напоминания: {FrontendUrl}/settings");

        return new ReminderContent(subject, string.Join(Environment.NewLine, lines), "reminder");
    }

    private async Task<ReminderContent?> BuildWeeklyAsync(
        User user,
        DateTime localNow,
        string name,
        CancellationToken cancellationToken)
    {
        var sinceDate = localNow.Date.AddDays(-6);
        var sinceUtc = StartOfLocalDayUtc(user, sinceDate);

        var activities = await _context.DailyActivities
            .AsNoTracking()
            .Where(a => a.UserId == user.Id && a.Date >= sinceDate && a.Date <= localNow.Date)
            .ToListAsync(cancellationToken);

        var minutes = activities.Sum(a => a.MinutesRead);
        var reviews = activities.Sum(a => a.WordsReviewed);
        var activeDays = activities.Count(a => a.GoalMet);

        var achievements = await _context.UserAchievements
            .CountAsync(a => a.UserId == user.Id && a.UnlockedAt >= sinceUtc, cancellationToken);

        var subject = $"Твоя неделя: {minutes} {Plural(minutes, "минута", "минуты", "минут")} и {reviews} {Plural(reviews, "повторение", "повторения", "повторений")}";

        var lines = new List<string>
        {
            $"Привет, {name}!",
            "",
            "Итоги недели:",
            $"· чтение — {minutes} {Plural(minutes, "минута", "минуты", "минут")};",
            $"· повторений — {reviews};",
            $"· дней с выполненной целью — {activeDays} из 7;",
            $"· стрик сейчас — {user.CurrentStreak} {Plural(user.CurrentStreak, "день", "дня", "дней")};",
            $"· новых достижений — {achievements}."
        };

        if (achievements > 0)
        {
            lines.Add("");
            lines.Add($"Посмотреть достижения: {FrontendUrl}/progress");
        }

        lines.Add("");
        lines.Add($"Продолжить: {FrontendUrl}/dashboard");
        lines.Add($"Отключить напоминания: {FrontendUrl}/settings");

        return new ReminderContent(subject, string.Join(Environment.NewLine, lines), "weekly");
    }

    private ReminderContent BuildFallback(User user) => new(
        "Пора позаниматься английским",
        string.Join(Environment.NewLine, new[]
        {
            $"Привет, {(string.IsNullOrWhiteSpace(user.DisplayName) ? "друг" : user.DisplayName)}!",
            "",
            "Пять минут повторения или одна страница книги — и день засчитан.",
            "",
            $"Открыть: {FrontendUrl}/dashboard"
        }),
        "test");

    private DateTime StartOfLocalDayUtc(User user, DateTime localDate)
    {
        var zone = UserTime.Resolve(user.TimeZoneId);
        var unspecified = DateTime.SpecifyKind(localDate.Date, DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(unspecified, zone);
    }

    private static string Plural(int n, string one, string few, string many)
    {
        var mod10 = n % 10;
        var mod100 = n % 100;
        if (mod10 == 1 && mod100 != 11) return one;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
        return many;
    }
}
