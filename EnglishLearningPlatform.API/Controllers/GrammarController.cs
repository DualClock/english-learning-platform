using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/grammar")]
[Authorize]
public class GrammarController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly ActivityService _activityService;

    public GrammarController(ApplicationDbContext context, ActivityService activityService)
    {
        _context = context;
        _activityService = activityService;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    [HttpPost]
    [Route("/api/admin/seed-grammar")]
    public async Task<ActionResult<object>> SeedGrammar(
        [FromServices] GrammarSeeder seeder,
        [FromServices] IConfiguration configuration,
        [FromServices] IWebHostEnvironment env,
        [FromHeader(Name = "X-Seed-Key")] string? seedKey)
    {
        var configuredKey = configuration["Seeder:Key"];
        if (!string.IsNullOrEmpty(configuredKey))
        {
            if (seedKey != configuredKey)
            {
                return Unauthorized(new { message = "Invalid seed key" });
            }
        }
        else if (!env.IsDevelopment())
        {
            return Forbid();
        }

        var result = await seeder.SeedAsync();

        if (result.Error != null)
        {
            return BadRequest(new { message = result.Error });
        }

        return Ok(new
        {
            alreadySeeded = result.AlreadySeeded,
            unitsCreated = result.UnitsCreated,
            unitsUpdated = result.UnitsUpdated,
            exercisesSeeded = result.ExercisesSeeded
        });
    }

    [HttpGet("units")]
    public async Task<ActionResult<List<object>>> GetUnits()
    {
        var userId = GetUserId();

        var progress = await _context.UserGrammarProgresses
            .Where(p => p.UserId == userId)
            .ToDictionaryAsync(p => p.UnitId);

        var units = await _context.GrammarUnits
            .OrderBy(u => u.Order)
            .Select(u => new
            {
                u.Id,
                u.Order,
                u.Title,
                u.CefrLevel,
                u.Section,
                u.ShortDescription
            })
            .ToListAsync();

        return Ok(units.Select(u =>
        {
            progress.TryGetValue(u.Id, out var p);
            return new
            {
                u.Id,
                u.Order,
                u.Title,
                u.CefrLevel,
                u.Section,
                u.ShortDescription,
                Completed = p != null,
                Score = p?.Score ?? 0
            };
        }).ToList());
    }

    [HttpGet("units/{id:int}")]
    public async Task<ActionResult<object>> GetUnit(int id)
    {
        var unit = await _context.GrammarUnits
            .Include(u => u.Exercises.OrderBy(e => e.Order))
            .FirstOrDefaultAsync(u => u.Id == id);

        if (unit == null) return NotFound();

        return Ok(new
        {
            unit.Id,
            unit.Order,
            unit.Title,
            unit.CefrLevel,
            unit.TheoryHtml,
            Exercises = unit.Exercises.OrderBy(e => e.Order).Select(e => new
            {
                e.Id,
                e.Order,
                e.Type,
                e.Prompt,
                Options = e.Type == "mc" ? ParseOptions(e.OptionsJson) : null
            }).ToList()
        });
    }

    [HttpPost("units/{id:int}/complete")]
    public async Task<ActionResult<object>> CompleteUnit(int id, [FromBody] CompleteGrammarRequest request)
    {
        var userId = GetUserId();

        var unit = await _context.GrammarUnits
            .Include(u => u.Exercises)
            .FirstOrDefaultAsync(u => u.Id == id);

        if (unit == null) return NotFound();

        if (request.Answers == null || request.Answers.Count == 0)
        {
            return BadRequest(new { message = "No answers provided" });
        }

        var answersByExerciseId = request.Answers
            .GroupBy(a => a.ExerciseId)
            .ToDictionary(g => g.Key, g => g.First().Answer ?? string.Empty);

        var results = new List<object>();
        var correctCount = 0;

        foreach (var exercise in unit.Exercises.OrderBy(e => e.Order))
        {
            answersByExerciseId.TryGetValue(exercise.Id, out var answer);
            answer ??= string.Empty;

            var correct = exercise.Type == "mc"
                ? CheckMc(exercise.CorrectAnswer, answer)
                : CheckFill(exercise.CorrectAnswer, answer);

            if (correct) correctCount++;

            results.Add(new
            {
                exerciseId = exercise.Id,
                correct,
                expected = ExpectedAnswer(exercise),
                explanation = exercise.Explanation
            });
        }

        var score = unit.Exercises.Count == 0
            ? 0
            : (int)Math.Round(correctCount * 100.0 / unit.Exercises.Count);

        var progress = await _context.UserGrammarProgresses
            .FirstOrDefaultAsync(p => p.UserId == userId && p.UnitId == id);

        if (progress == null)
        {
            progress = new UserGrammarProgress
            {
                UserId = userId,
                UnitId = id,
                Score = score,
                CompletedAt = DateTime.UtcNow
            };
            _context.UserGrammarProgresses.Add(progress);
        }
        else
        {
            // Храним лучший результат
            if (score > progress.Score)
            {
                progress.Score = score;
                progress.CompletedAt = DateTime.UtcNow;
            }
        }

        await _context.SaveChangesAsync();

        if (score >= 50)
        {
            await _activityService.TrackAsync(userId, "quiz_done", 1);
        }

        return Ok(new { score, results });
    }

    private static bool CheckMc(string correctAnswer, string answer)
    {
        var normalized = answer.Trim();
        return normalized == correctAnswer.Trim();
    }

    private static bool CheckFill(string correctAnswer, string answer)
    {
        var normalized = Normalize(answer);
        if (normalized.Length == 0) return false;

        return correctAnswer
            .Split('|')
            .Select(v => Normalize(v))
            .Any(v => v == normalized);
    }

    private static string Normalize(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;

        var normalized = value.Trim().ToLowerInvariant();
        normalized = normalized.Replace('\u2019', '\''); // ’ → '
        normalized = Regex.Replace(normalized, @"\s+", " ");
        return normalized;
    }

    private static string ExpectedAnswer(GrammarExercise exercise)
    {
        return exercise.Type == "mc" ? ParseOptions(exercise.OptionsJson)[int.Parse(exercise.CorrectAnswer)] : exercise.CorrectAnswer;
    }

    private static List<string> ParseOptions(string? optionsJson)
    {
        if (string.IsNullOrWhiteSpace(optionsJson)) return new List<string>();

        try
        {
            return JsonSerializer.Deserialize<List<string>>(optionsJson) ?? new List<string>();
        }
        catch (JsonException)
        {
            return new List<string>();
        }
    }
}

public class CompleteGrammarRequest
{
    public List<GrammarAnswerDto>? Answers { get; set; }
}

public class GrammarAnswerDto
{
    public int ExerciseId { get; set; }
    public string? Answer { get; set; }
}
