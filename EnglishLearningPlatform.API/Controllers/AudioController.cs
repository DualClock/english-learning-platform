using System.Security.Claims;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/audio")]
[Authorize]
public class AudioController : ControllerBase
{
    private const int MaxTextLength = 300;

    private readonly SpeechService _speechService;

    public AudioController(SpeechService speechService)
    {
        _speechService = speechService;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // GET: api/audio/tts?text=hello
    // Отдаёт WAV напрямую: фронтенд забирает его с Authorization-заголовком
    // и играет через Audio(). Кэш на диске — повторные запросы бесплатны.
    [HttpGet("tts")]
    public async Task<IActionResult> GetTts([FromQuery] string? text, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return BadRequest(new { error = "Пустой текст для озвучки." });
        }

        if (text.Length > MaxTextLength)
        {
            return BadRequest(new { error = $"Слишком длинный текст для озвучки (максимум {MaxTextLength} символов)." });
        }

        try
        {
            var audio = await _speechService.SynthesizeAsync(text, GetUserId(), cancellationToken);
            if (audio == null || audio.Length == 0)
            {
                return StatusCode(503, new { error = "Озвучка временно недоступна. Попробуйте ещё раз чуть позже." });
            }

            return File(audio, "audio/wav");
        }
        catch (AiUnavailableException ex)
        {
            return StatusCode(503, new { error = ex.Message });
        }
    }
}
