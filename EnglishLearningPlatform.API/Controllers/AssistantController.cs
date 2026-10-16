using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class AssistantController : ControllerBase
{
    private readonly AssistantService _assistantService;

    public AssistantController(AssistantService assistantService)
    {
        _assistantService = assistantService;
    }

    [HttpPost("chat")]
    public async Task<IActionResult> Chat([FromBody] AssistantChatRequest request)
    {
        var reply = await _assistantService.ChatAsync(request.Messages, request.UserLevel);

        if (reply == null)
        {
            return BadRequest(new { message = "Assistant is unavailable" });
        }

        return Ok(new { reply });
    }

    [HttpPost("analyze")]
    public async Task<IActionResult> Analyze([FromBody] AssistantAnalyzeRequest request)
    {
        var result = await _assistantService.AnalyzeAsync(request.Text, request.UserLevel);

        if (result == null)
        {
            return BadRequest(new { message = "Analysis failed" });
        }

        return Ok(result);
    }
}

public record AssistantChatRequest(List<AssistantChatMessage>? Messages, string? UserLevel);
public record AssistantAnalyzeRequest(string Text, string? UserLevel);
