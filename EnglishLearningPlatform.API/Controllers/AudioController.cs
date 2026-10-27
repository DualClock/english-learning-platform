using System.Security.Claims;
using EnglishLearningPlatform.API.Security;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/audio")]
[Authorize]
[RequireConfirmedEmail]
public class AudioController : ControllerBase
{
    private readonly SpeechService _speechService;
    private readonly Microsoft.Extensions.Logging.ILogger<AudioController> _logger_;

    public AudioController(SpeechService speechService, Microsoft.Extensions.Logging.ILogger<AudioController> logger)
    {
        _speechService = speechService;
        _logger_ = logger;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // GET: api/audio/tts?text=hello
    // Отдаёт WAV напрямую: фронтенд забирает его с Authorization-заголовком
    // и играет через Audio(). Кэш на диске — повторные запросы бесплатны.
    // Длинный текст не режется здесь: сервис сам озвучивает его частями и
    // склеивает, поэтому абзац (≈400 символов) приходит целиком.
    [HttpGet("tts")]
    public async Task<IActionResult> GetTts([FromQuery] string? text, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return BadRequest(new { error = "Пустой текст для озвучки." });
        }

        if (text.Length > SpeechService.MaxTextLength)
        {
            // 413, а не обрезка: тело корректное, но слишком большое. Молча
            // укоротить текст — значит отдать человеку половину фразы, не сказав.
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new
            {
                error = $"Слишком длинный текст для озвучки (максимум {SpeechService.MaxTextLength} символов)."
            });
        }

        try
        {
            var audio = await _speechService.SynthesizeAsync(text, GetUserId(), cancellationToken);
            if (audio == null || audio.Data.Length == 0)
            {
                return StatusCode(503, new { error = "Озвучка временно недоступна. Попробуйте ещё раз чуть позже." });
            }

            // Серверный голос приходит WAV-ом от Gemini, а бесплатный резерв — MP3,
            // поэтому тип берём из результата, а не прибиваем гвоздями.
            return File(audio.Data, audio.ContentType);
        }
        catch (SpeechMergeUnsupportedException ex)
        {
            /*
             * Куски пришли в разных контейнерах (WAV от Gemini и MP3 от резерва):
             * без перекодирования их не склеить, и битый файл хуже ошибки.
             *
             * Но это НЕ повод отказывать человеку в звуке: клиент при таком отказе
             * читает фразу браузерным голосом (useTts.ts: любая не-ok-ветка →
             * playBrowser). Раньше здесь стоял 413, и браузерная ветка получала
             * «ошибку формата», хотя на деле это «серверный голос сейчас не готов» —
             * ровно та же семантика, что у 503 ниже.
             */
            _logger_.LogWarning(ex, "TTS: куски в разных форматах, отдаю браузерный голос");
            return StatusCode(503, new { error = "Озвучка временно недоступна. Попробуйте ещё раз чуть позже." });
        }
        catch (SpeechTextTooLongException ex)
        {
            // 413, а не 400: тело запроса было корректным, но слишком большим.
            // Обрезка текста (старое поведение) запрещена — пользователь не должен
            // слышать фразу, укороченную втайне от него.
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = ex.Message });
        }
        catch (AiUnavailableException ex)
        {
            return StatusCode(503, new { error = ex.Message });
        }
    }
}
