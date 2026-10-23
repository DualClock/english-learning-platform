using System.Security.Claims;
using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ReviewController : ControllerBase
{
    private readonly SrsService _srsService;
    private readonly ApplicationDbContext _context;
    private readonly ActivityService _activityService;
    private readonly IMemoryCache _cache;

    public ReviewController(
        SrsService srsService,
        ApplicationDbContext context,
        ActivityService activityService,
        IMemoryCache cache)
    {
        _srsService = srsService;
        _context = context;
        _activityService = activityService;
        _cache = cache;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    private static string GrantKey(string userId, string undoToken) =>
        $"review-undo-grant:{userId}:{undoToken}";

    [HttpGet("today")]
    public async Task<ActionResult<object>> GetTodayReview()
    {
        var userId = GetUserId();

        var user = await _context.Users.AsNoTracking().FirstAsync(u => u.Id == userId);
        var queue = await _srsService.GetTodayQueueAsync(userId, user.DailyNewWords);

        var words = queue.DueWords
            .Concat(queue.NewWords)
            .Select(w => new
            {
                wordId = w.WordId,
                text = w.Word.Text,
                emoji = w.Emoji,
                imageUrl = w.ImageUrl,
                definitions = w.Word.Definitions.Select(d => new
                {
                    definition = d.Definition,
                    partOfSpeech = d.PartOfSpeech,
                    example = d.Example
                }),
                interval = w.Interval,
                intervalMinutes = w.IntervalMinutes,
                easeFactor = w.EaseFactor,
                repetitionCount = w.RepetitionCount,
                lapses = w.Lapses,
                isLeech = w.IsLeech,
                isNew = w.LastReviewedAt == null
            })
            .ToList();

        return Ok(new
        {
            // Сколько всего карточек на сегодня (с учётом лимита новых)
            totalCount = queue.DueCount + Math.Min(queue.NewCount, queue.NewLimit),
            reviewCount = queue.DueCount,
            newCount = Math.Min(queue.NewCount, queue.NewLimit),
            newWordsAvailable = queue.NewCount,
            newLimit = queue.NewLimit,
            reviewLimit = queue.ReviewLimit,
            words
        });
    }

    [HttpPost("{wordId}/quality/{quality}")]
    public async Task<IActionResult> ReviewWord(int wordId, int quality)
    {
        if (quality < 1 || quality > 5)
        {
            return BadRequest(new { message = "Оценка должна быть от 1 до 5" });
        }

        var result = await _srsService.ReviewWordAsync(GetUserId(), wordId, quality);
        if (result == null) return NotFound();

        var userId = GetUserId();
        var grant = await _activityService.TrackAsync(userId, "review_word", 1);
        _cache.Set(GrantKey(userId, result.UndoToken), grant, TimeSpan.FromMinutes(10));

        return Ok(new
        {
            interval = result.IntervalDays,
            intervalMinutes = result.IntervalMinutes,
            easeFactor = result.EaseFactor,
            nextReviewDate = result.NextReviewDate,
            repetitions = result.RepetitionCount,
            lapses = result.Lapses,
            isLeech = result.IsLeech,
            undoToken = result.UndoToken,
            xpEarned = grant.XpEarned
        });
    }

    [HttpPost("{wordId}/undo")]
    public async Task<IActionResult> UndoReview(int wordId, [FromBody] UndoReviewDto dto)
    {
        var userId = GetUserId();
        if (string.IsNullOrWhiteSpace(dto.Token))
        {
            return BadRequest(new { message = "Не указан токен отмены" });
        }

        var undone = await _srsService.UndoReviewAsync(userId, wordId, dto.Token);
        if (!undone)
        {
            return Conflict(new { message = "Этот ответ уже нельзя отменить" });
        }

        var grantKey = GrantKey(userId, dto.Token);
        if (_cache.TryGetValue(grantKey, out ActivityGrant? grant) && grant != null)
        {
            await _activityService.UndoReviewActivityAsync(userId, grant.ActionXp, grant.GoalXp);
            _cache.Remove(grantKey);
        }

        return Ok(new { undone = true });
    }

    [HttpGet("quiz")]
    public async Task<ActionResult<object>> GetQuiz([FromQuery] int count = 10)
    {
        var userId = GetUserId();

        // Кламп: без него ?count=100000 тянул бы из базы всю таблицу UserWords
        var take = Math.Clamp(count, 1, 50);

        var userWords = await _context.UserWords
            .AsNoTracking()
            .Where(uw => uw.UserId == userId
                         && uw.Word.Definitions.Any(d => d.Definition != ""))
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .ToListAsync();

        var pool = userWords
            .Select(uw => new QuizCandidate(
                uw.WordId,
                uw.Word.Text,
                uw.Word.Definitions
                    .Where(d => d.Definition != "")
                    .OrderBy(d => d.DisplayOrder)
                    .Select(d => d.Definition)
                    .First(),
                Level: null))
            .GroupBy(word => word.WordId)
            .Select(group => group.First())
            .ToList();

        if (pool.Count < 4)
        {
            // Не ошибка, а «пока нечего тестировать»: фронтенд показывает
            // дружелюбное пустое состояние вместо красного экрана.
            return Ok(new
            {
                questions = Array.Empty<object>(),
                reason = "not_enough_words",
                requiredWords = 4,
                currentWords = pool.Count
            });
        }

        // Дистракторы в первую очередь берём из того же уровня CEFR:
        // так аудирование проверяет понимание, а не угадывание по длине слова.
        var texts = pool.Select(word => word.Text).Distinct().ToList();
        var levels = await _context.WordLevels
            .AsNoTracking()
            .Where(level => texts.Contains(level.Text))
            .Select(level => new { level.Text, level.CefrLevel })
            .ToListAsync();
        var levelByText = levels
            .GroupBy(level => level.Text, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => group.First().CefrLevel.ToLowerInvariant(),
                StringComparer.OrdinalIgnoreCase);

        pool = pool
            .Select(word => word with
            {
                Level = levelByText.TryGetValue(word.Text, out var level) ? level : null
            })
            .ToList();

        var questions = new List<QuizQuestion>();

        foreach (var target in pool.OrderBy(_ => Guid.NewGuid()).Take(take))
        {
            var distractors = pool
                .Where(word => word.WordId != target.WordId
                               && !string.Equals(
                                   word.Definition,
                                   target.Definition,
                                   StringComparison.OrdinalIgnoreCase)
                               && word.Level == target.Level)
                .GroupBy(word => word.Definition, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First().Definition)
                .OrderBy(_ => Guid.NewGuid())
                .Take(3)
                .ToList();

            if (distractors.Count < 3)
            {
                var used = new HashSet<string>(distractors, StringComparer.OrdinalIgnoreCase)
                {
                    target.Definition
                };

                foreach (var other in pool.OrderBy(_ => Guid.NewGuid()))
                {
                    if (!used.Add(other.Definition)) continue;
                    distractors.Add(other.Definition);
                    if (distractors.Count == 3) break;
                }
            }

            if (distractors.Count < 3) continue;

            var options = distractors
                .Append(target.Definition)
                .OrderBy(_ => Guid.NewGuid())
                .ToList();

            questions.Add(new QuizQuestion(
                target.WordId,
                target.Text,
                options,
                options.IndexOf(target.Definition)));
        }

        if (questions.Count < 4)
        {
            return Ok(new
            {
                questions = Array.Empty<object>(),
                reason = "not_enough_words",
                requiredWords = 4,
                currentWords = questions.Count
            });
        }

        var token = Guid.NewGuid().ToString("N");
        _cache.Set(
            QuizTokenKey(userId, token),
            new QuizSnapshot(questions.Count),
            TimeSpan.FromHours(2));

        return Ok(new
        {
            questions,
            quizToken = token,
            total = questions.Count
        });
    }

    [HttpPost("quiz/result")]
    public async Task<IActionResult> SaveQuizResult([FromBody] QuizResultRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Token))
        {
            return BadRequest(new { message = "Не указан токен теста" });
        }

        var userId = GetUserId();
        var key = QuizTokenKey(userId, request.Token);

        if (!_cache.TryGetValue(key, out QuizSnapshot? snapshot) || snapshot == null)
        {
            return Conflict(new { message = "Результат уже сохранён или тест устарел" });
        }

        if (request.Correct < 0 || request.Correct > snapshot.Total)
        {
            return BadRequest(new { message = "Некорректное число верных ответов" });
        }

        var mode = string.Equals(request.Mode, "listening", StringComparison.OrdinalIgnoreCase)
            ? "listening"
            : "reading";

        // Один завершённый тест — одно начисление quiz_done. Повторная отправка
        // того же токена не даёт XP: токен живёт только до первого сохранения.
        var grant = await _activityService.TrackAsync(userId, "quiz_done", 1);

        _context.AnalyticsEvents.Add(new AnalyticsEvent
        {
            UserId = userId,
            Event = "quiz_finished",
            Meta = JsonSerializer.Serialize(new
            {
                mode,
                correct = request.Correct,
                total = snapshot.Total
            })
        });
        await _context.SaveChangesAsync();
        _cache.Remove(key);

        return Ok(new
        {
            xpEarned = grant.XpEarned,
            goalBonus = grant.GoalXp,
            total = snapshot.Total,
            correct = request.Correct,
            mode
        });
    }

    [HttpGet("quiz/history")]
    public async Task<IActionResult> GetQuizHistory([FromQuery] int limit = 5)
    {
        var take = Math.Clamp(limit, 1, 20);
        var userId = GetUserId();

        var rows = await _context.AnalyticsEvents
            .AsNoTracking()
            .Where(row => row.UserId == userId && row.Event == "quiz_finished")
            .OrderByDescending(row => row.CreatedAt)
            .Take(take)
            .Select(row => new { row.Id, row.Meta, row.CreatedAt })
            .ToListAsync();

        var items = new List<object>();
        foreach (var row in rows)
        {
            try
            {
                using var document = JsonDocument.Parse(row.Meta ?? "{}");
                var root = document.RootElement;
                var total = root.TryGetProperty("total", out var totalValue)
                    ? totalValue.GetInt32()
                    : 0;
                if (total <= 0) continue;

                items.Add(new
                {
                    id = row.Id,
                    mode = root.TryGetProperty("mode", out var modeValue)
                        ? modeValue.GetString() ?? "reading"
                        : "reading",
                    correct = root.TryGetProperty("correct", out var correctValue)
                        ? correctValue.GetInt32()
                        : 0,
                    total,
                    createdAt = row.CreatedAt
                });
            }
            catch (JsonException)
            {
                // Старые или повреждённые записи просто не показываем.
            }
        }

        return Ok(new { items });
    }

    private static string QuizTokenKey(string userId, string token) =>
        $"quiz-result:{userId}:{token}";

    private sealed record QuizCandidate(
        int WordId,
        string Text,
        string Definition,
        string? Level);

    private sealed record QuizQuestion(
        int WordId,
        string Text,
        List<string> Options,
        int CorrectIndex);

    private sealed record QuizSnapshot(int Total);
}

public record UndoReviewDto(string Token);

public record QuizResultRequest(
    string Token,
    int Correct,
    string? Mode);