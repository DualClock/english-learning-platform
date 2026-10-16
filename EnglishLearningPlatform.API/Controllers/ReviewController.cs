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
        var words = await _srsService.GetWordsForReviewAsync(userId);
        var count = await _srsService.GetReviewCountAsync(userId);

        return Ok(new
        {
            totalCount = count,
            words = words.Select(w => new
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
                easeFactor = w.EaseFactor,
                repetitionCount = w.RepetitionCount
            })
        });
    }

    [HttpPost("{wordId}/quality/{quality}")]
    public async Task<IActionResult> ReviewWord(int wordId, int quality)
    {
        var result = await _srsService.ReviewWordAsync(GetUserId(), wordId, quality);
        if (result == null) return NotFound();

        await _activityService.TrackAsync(GetUserId(), "review_word", 1);

        return Ok(new
        {
            interval = result.Interval,
            easeFactor = result.EaseFactor,
            nextReviewDate = result.NextReviewDate
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
            return BadRequest(new { message = "Нужно минимум 4 слова для теста" });

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