using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ReviewController : ControllerBase
{
    private readonly SrsService _srsService;
    private readonly ApplicationDbContext _context;
    private readonly ActivityService _activityService;

    public ReviewController(SrsService srsService, ApplicationDbContext context, ActivityService activityService)
    {
        _srsService = srsService;
        _context = context;
        _activityService = activityService;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

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

        await _activityService.TrackAsync(GetUserId(), "review_word", 1);

        return Ok(new
        {
            interval = result.IntervalDays,
            intervalMinutes = result.IntervalMinutes,
            easeFactor = result.EaseFactor,
            nextReviewDate = result.NextReviewDate,
            repetitions = result.RepetitionCount,
            lapses = result.Lapses,
            isLeech = result.IsLeech
        });
    }

    [HttpGet("quiz")]
    public async Task<ActionResult<object>> GetQuiz([FromQuery] int count = 10)
    {
        var userId = GetUserId();

        var words = await _context.UserWords
            .Where(uw => uw.UserId == userId)
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .OrderBy(x => Guid.NewGuid())
            .Take(count)
            .Select(uw => new
            {
                wordId = uw.WordId,
                text = uw.Word.Text,
                correctDefinition = uw.Word.Definitions.FirstOrDefault()!.Definition
            })
            .ToListAsync();

        if (words.Count < 4)
        {
            // Не ошибка, а «пока нечего тестировать»: фронтенд показывает
            // дружелюбное пустое состояние вместо красного экрана.
            return Ok(new
            {
                questions = Array.Empty<object>(),
                reason = "not_enough_words",
                requiredWords = 4,
                currentWords = words.Count
            });
        }

        var quiz = words.Select(w => {
            var wrongAnswers = words
                .Where(x => x.wordId != w.wordId)
                .OrderBy(x => Guid.NewGuid())
                .Take(3)
                .Select(x => x.correctDefinition)
                .ToList();

            var options = wrongAnswers.Append(w.correctDefinition).OrderBy(x => Guid.NewGuid()).ToList();

            return new
            {
                w.wordId,
                w.text,
                options,
                correctIndex = options.IndexOf(w.correctDefinition)
            };
        }).ToList();

        return Ok(new { questions = quiz });
    }
}