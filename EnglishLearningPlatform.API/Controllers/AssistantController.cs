using System.Security.Claims;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

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

    public AssistantController(AssistantService assistantService)
    {
        _assistantService = assistantService;
    }

    [HttpPost("chat")]
    public async Task<IActionResult> Chat([FromBody] AssistantChatRequest request)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        try
        {
            var reply = await _assistantService.ChatAsync(request.Messages, request.UserLevel, userId);

            if (reply == null)
            {
                return StatusCode(503, new { error = ChatUnavailableMessage });
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
}

public record AssistantChatRequest(List<AssistantChatMessage>? Messages, string? UserLevel);
public record AssistantAnalyzeRequest(string Text, string? UserLevel);
