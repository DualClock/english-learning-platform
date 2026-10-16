using System.Security.Claims;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class AiController : ControllerBase
{
    private readonly AiService _aiService;

    public AiController(AiService aiService)
    {
        _aiService = aiService;
    }

    [HttpPost("translate")]
    public async Task<IActionResult> Translate([FromBody] TranslateRequest request)
    {
        var hasContext = !string.IsNullOrWhiteSpace(request.Context);
        var targetLanguage = request.TargetLanguage ?? "ru";

        // Без контекста — быстрый путь: справочник WordLevels или бесплатный Google Translate.
        // FastTranslate работает только для русского языка.
        if (!hasContext && targetLanguage == "ru")
        {
            var fast = await _aiService.FastTranslateAsync(request.Word);
            if (fast != null)
            {
                return Ok(fast);
            }
        }

        var result = await _aiService.TranslateWordAsync(request.Word, request.Context, targetLanguage);
        if (result != null)
        {
            return Ok(result);
        }

        // Gemini не справился (даже с контекстом) — быстрый fallback, контекст потеряем,
        // но пользователь получит перевод вместо ошибки
        if (targetLanguage == "ru")
        {
            var fallback = await _aiService.FastTranslateAsync(request.Word);
            if (fallback != null)
            {
                return Ok(fallback);
            }
        }

        return BadRequest(new { message = "Translation failed" });
    }
}

public record TranslateRequest(
    string Word,
    string? Context,
    string? TargetLanguage
);