using System.Security.Claims;
using EnglishLearningPlatform.API.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/profile")]
[Authorize]
public class ProfileController : ControllerBase
{
    private readonly UserManager<User> _userManager;

    public ProfileController(UserManager<User> userManager)
    {
        _userManager = userManager;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    public record ChangePasswordDto(string CurrentPassword, string NewPassword);

    // POST: api/profile/change-password
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordDto dto)
    {
        var user = await _userManager.FindByIdAsync(GetUserId());
        if (user == null) return NotFound();

        var result = await _userManager.ChangePasswordAsync(user, dto.CurrentPassword, dto.NewPassword);
        if (!result.Succeeded)
        {
            return BadRequest(new
            {
                message = "Не удалось сменить пароль",
                errors = result.Errors.Select(e => e.Description).ToArray()
            });
        }

        return Ok(new { message = "Password changed successfully" });
    }

    // GET: api/profile
    [HttpGet]
    public async Task<IActionResult> GetProfile()
    {
        var user = await _userManager.FindByIdAsync(GetUserId());
        if (user == null) return NotFound();

        return Ok(ToDto(user));
    }

    // PUT: api/profile
    [HttpPut]
    public async Task<IActionResult> UpdateProfile(UpdateProfileDto dto)
    {
        var user = await _userManager.FindByIdAsync(GetUserId());
        if (user == null) return NotFound();

        if (dto.CefrLevel != null) user.CefrLevel = dto.CefrLevel;
        if (dto.StudyGoal != null) user.StudyGoal = dto.StudyGoal;
        if (dto.DailyGoalMinutes.HasValue) user.DailyGoalMinutes = Math.Max(1, dto.DailyGoalMinutes.Value);
        if (dto.DisplayName != null) user.DisplayName = dto.DisplayName.Trim();

        var result = await _userManager.UpdateAsync(user);
        if (!result.Succeeded) return BadRequest(result.Errors);

        return Ok(ToDto(user));
    }

    // GET: api/profile/placement — доступен без авторизации (проходит в onboarding до регистрации)
    [HttpGet("placement")]
    [AllowAnonymous]
    public IActionResult GetPlacementTest()
    {
        return Ok(new
        {
            questions = PlacementTest.Questions.Select(q => new
            {
                id = q.Id,
                prompt = q.Prompt,
                options = q.Options
            })
        });
    }

    // POST: api/profile/placement/result — только считает уровень, ничего не сохраняет
    [HttpPost("placement/result")]
    [AllowAnonymous]
    public IActionResult SubmitPlacementResult(PlacementResultDto dto)
    {
        var answers = dto.Answers ?? new List<PlacementAnswerDto>();
        var total = PlacementTest.Questions.Length;
        var correct = answers.Count(a =>
            PlacementTest.Questions.Any(q => q.Id == a.Id && q.CorrectIndex == a.Choice));

        var level = correct switch
        {
            <= 4 => "a1",
            <= 7 => "a2",
            <= 10 => "b1",
            <= 13 => "b2",
            _ => "c1"
        };

        return Ok(new { cefrLevel = level, correctCount = correct, total });
    }

    private static object ToDto(User user) => new
    {
        email = user.Email,
        displayName = user.DisplayName,
        cefrLevel = user.CefrLevel,
        studyGoal = user.StudyGoal,
        dailyGoalMinutes = user.DailyGoalMinutes,
        currentStreak = user.CurrentStreak,
        longestStreak = user.LongestStreak,
        totalXp = user.TotalXp,
        createdAt = user.CreatedAt,
        lastActivityDate = user.LastActivityDate
    };
}

public record UpdateProfileDto(string? CefrLevel, string? StudyGoal, int? DailyGoalMinutes, string? DisplayName);
public record PlacementAnswerDto(int Id, int Choice);
public record PlacementResultDto(List<PlacementAnswerDto>? Answers);

internal static class PlacementTest
{
    public record Question(int Id, string Prompt, string[] Options, int CorrectIndex);

    // Вопросы идут от простого к сложному. 16 вопросов ≈ 3-5 минут.
    public static readonly Question[] Questions = new[]
    {
        new Question(1, "В кафе: «Hi! I _____ a coffee, please.»", new[] { "want", "wants", "wanting", "am want" }, 0),
        new Question(2, "Как правильно представиться?", new[] { "I am from Russia.", "I from Russia.", "I is from Russia.", "Me from Russia." }, 0),
        new Question(3, "Выбери верный вариант:", new[] { "She don't like tea.", "She doesn't likes tea.", "She doesn't like tea.", "She not like tea." }, 2),
        new Question(4, "Вчера: «We _____ to the cinema last night.»", new[] { "go", "gone", "went", "going" }, 2),
        new Question(5, "«I _____ TV when you called.»", new[] { "watched", "was watching", "watch", "am watching" }, 1),
        new Question(6, "В магазине одежды: «This shirt is _____ than that one.»", new[] { "cheaper", "cheapest", "more cheap", "the cheaper" }, 0),
        new Question(7, "«I have known her _____ five years.»", new[] { "since", "during", "from", "for" }, 3),
        new Question(8, "«There isn't _____ milk left in the fridge.»", new[] { "many", "much", "few", "a few" }, 1),
        new Question(9, "«If I _____ you, I would take the job.»", new[] { "am", "was", "were", "will be" }, 2),
        new Question(10, "Письмо коллеге: «The report _____ by the manager yesterday.»", new[] { "wrote", "was written", "is written", "has written" }, 1),
        new Question(11, "«By the time we arrived, the film _____.»", new[] { "already started", "has already started", "had already started", "was already starting" }, 2),
        new Question(12, "«She suggested _____ a taxi.»", new[] { "to take", "taking", "take", "that we take it" }, 1),
        new Question(13, "«You _____ be tired after such a long flight.»", new[] { "must", "can", "should", "may" }, 0),
        new Question(14, "Косвенная речь: «He asked me where I _____.»", new[] { "do live", "live", "lived", "did live" }, 2),
        new Question(15, "«Had I known about the meeting, I _____ earlier.»", new[] { "would come", "would have come", "had come", "came" }, 1),
        new Question(16, "«Rarely _____ such a breathtaking view.»", new[] { "I have seen", "have I seen", "I saw", "did I saw" }, 1)
    };
}
