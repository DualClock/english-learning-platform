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
public class AssistantController : ControllerBase
{
    private const string ChatUnavailableMessage =
        "Собеседник сейчас недоступен. Попробуйте ещё раз чуть позже.";
    private const string AnalyzeUnavailableMessage =
        "Не удалось разобрать сообщение: сервис временно недоступен. Попробуйте позже.";

    private readonly AssistantService _assistantService;
    private readonly ApplicationDbContext _context;
    private readonly ActivityService _activityService;

    public AssistantController(
        AssistantService assistantService,
        ApplicationDbContext context,
        ActivityService activityService)
    {
        _assistantService = assistantService;
        _context = context;
        _activityService = activityService;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    [HttpPost("chat")]
    public async Task<IActionResult> Chat([FromBody] AssistantChatRequest request)
    {
        // Лимиты входа: без них один запрос мог бы утащить всю историю чата в промпт
        var messages = request.Messages ?? new List<AssistantChatMessage>();
        if (messages.Count > 30)
        {
            return BadRequest(new { error = "Слишком длинная история переписки." });
        }

        if (messages.Any(m => (m.Text?.Length ?? 0) > 4000))
        {
            return BadRequest(new { error = "Сообщение слишком длинное (максимум 4000 символов)." });
        }

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        try
        {
            var reply = await _assistantService.ChatAsync(messages, request.UserLevel, userId);

            if (reply == null)
            {
                return StatusCode(503, new { error = ChatUnavailableMessage });
            }

            // XP за живую практику с Alex: кап 10 в день считается в ActivityService,
            // чтобы частые сообщения не превращались в фарм
            if (!string.IsNullOrEmpty(userId))
            {
                await _activityService.TrackAsync(userId, "alex_message", 1);
            }

            return Ok(new { reply });
        }
        catch (AiUnavailableException ex)
        {
            return StatusCode(503, new { error = ex.Message });
        }
    }

    [HttpPost("analyze")]
    public async Task<IActionResult> Analyze([FromBody] AssistantAnalyzeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Text))
        {
            return BadRequest(new { error = "Пустой текст." });
        }

        if (request.Text.Length > 4000)
        {
            return BadRequest(new { error = "Текст слишком длинный (максимум 4000 символов)." });
        }

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        try
        {
            var result = await _assistantService.AnalyzeAsync(request.Text, request.UserLevel, userId);

            if (result == null)
            {
                return StatusCode(503, new { error = AnalyzeUnavailableMessage });
            }

            return Ok(result);
        }
        catch (AiUnavailableException ex)
        {
            return StatusCode(503, new { error = ex.Message });
        }
    }

    // GET: api/assistant/errors — банк типичных ошибок пользователя
    [HttpGet("errors")]
    public async Task<IActionResult> GetErrors([FromQuery] bool includeResolved = false)
    {
        var userId = GetUserId();

        var query = _context.UserErrorBankEntries.AsNoTracking()
            .Where(e => e.UserId == userId);

        if (!includeResolved)
        {
            query = query.Where(e => e.ResolvedAt == null);
        }

        var items = await query
            .OrderByDescending(e => e.CreatedAt)
            .Take(100)
            .Select(e => new
            {
                id = e.Id,
                original = e.Original,
                suggestion = e.Suggestion,
                type = e.Type,
                explanation = e.Explanation,
                createdAt = e.CreatedAt,
                resolved = e.ResolvedAt != null
            })
            .ToListAsync();

        var unresolvedCount = await _context.UserErrorBankEntries
            .CountAsync(e => e.UserId == userId && e.ResolvedAt == null);

        return Ok(new { items, unresolvedCount });
    }

    // POST: api/assistant/errors/{id}/resolve — отметить ошибку отработанной
    [HttpPost("errors/{id:int}/resolve")]
    public async Task<IActionResult> ResolveError(int id)
    {
        var userId = GetUserId();

        var entry = await _context.UserErrorBankEntries
            .FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId);

        if (entry == null)
        {
            return NotFound(new { error = "Запись не найдена." });
        }

        if (entry.ResolvedAt == null)
        {
            entry.ResolvedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();
        }

        return Ok(new { id = entry.Id, resolvedAt = entry.ResolvedAt });
    }
}

public record AssistantChatRequest(List<AssistantChatMessage>? Messages, string? UserLevel);
public record AssistantAnalyzeRequest(string Text, string? UserLevel);
