using System.Security.Claims;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/pronunciation")]
[Authorize]
public class PronunciationController : ControllerBase
{
    private const int MaxTargetLength = 100;
    private const int MaxAudioBytes = 3 * 1024 * 1024;
    // base64 раздувает размер примерно на треть — проверяем строку до декодирования
    private const int MaxBase64Length = MaxAudioBytes * 4 / 3 + 1024;

    private readonly SpeechService _speechService;
    private readonly PronunciationService _pronunciationService;
    private readonly ActivityService _activityService;

    public PronunciationController(
        SpeechService speechService,
        PronunciationService pronunciationService,
        ActivityService activityService)
    {
        _speechService = speechService;
        _pronunciationService = pronunciationService;
        _activityService = activityService;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // POST: api/pronunciation/check — сравнить запись с эталоном
    [HttpPost("check")]
    public async Task<IActionResult> Check([FromBody] PronunciationCheckRequest request)
    {
        var target = request?.Target?.Trim();
        if (string.IsNullOrWhiteSpace(target))
        {
            return BadRequest(new { error = "Не указан образец для сравнения." });
        }

        if (target.Length > MaxTargetLength)
        {
            return BadRequest(new { error = $"Слишком длинный образец (максимум {MaxTargetLength} символов)." });
        }

        var audio = NormalizeAudio(request?.AudioBase64, out var audioError);
        if (audio == null)
        {
            return BadRequest(new { error = audioError });
        }

        var userId = GetUserId();

        try
        {
            var transcribed = await _speechService.TranscribeAsync(
                audio, request?.MimeType ?? "audio/wav", userId, HttpContext.RequestAborted);

            if (transcribed == null)
            {
                return StatusCode(503, new
                {
                    error = "Не удалось распознать речь: сервис временно недоступен. Попробуйте ещё раз."
                });
            }

            var evaluation = _pronunciationService.Evaluate(target, transcribed);

            await _activityService.TrackAsync(userId, "pronunciation_check", 1);

            return Ok(new
            {
                transcribed = evaluation.Transcribed,
                similarity = evaluation.Similarity,
                correct = evaluation.Correct,
                advice = evaluation.Advice,
                mismatches = evaluation.Mismatches.Select(m => new { expected = m.Expected, heard = m.Heard })
            });
        }
        catch (AiUnavailableException ex)
        {
            return StatusCode(503, new { error = ex.Message });
        }
    }

    // POST: api/pronunciation/transcribe — «чистая» транскрипция для голосового ввода
    // (используется микрофоном у Alex). Без сравнения и без начисления XP.
    [HttpPost("transcribe")]
    public async Task<IActionResult> Transcribe([FromBody] PronunciationTranscribeRequest request)
    {
        var audio = NormalizeAudio(request?.AudioBase64, out var audioError);
        if (audio == null)
        {
            return BadRequest(new { error = audioError });
        }

        try
        {
            var transcribed = await _speechService.TranscribeAsync(
                audio, request?.MimeType ?? "audio/wav", GetUserId(), HttpContext.RequestAborted);

            if (transcribed == null)
            {
                return StatusCode(503, new
                {
                    error = "Не удалось распознать речь: сервис временно недоступен. Попробуйте ещё раз."
                });
            }

            return Ok(new { transcribed });
        }
        catch (AiUnavailableException ex)
        {
            return StatusCode(503, new { error = ex.Message });
        }
    }

    private static string? NormalizeAudio(string? audioBase64, out string error)
    {
        error = string.Empty;

        if (string.IsNullOrWhiteSpace(audioBase64))
        {
            error = "Пустая запись.";
            return null;
        }

        var payload = audioBase64.Trim();

        // Фронтенд может прислать data URL — отрезаем префикс
        var commaIndex = payload.IndexOf(",", StringComparison.Ordinal);
        if (payload.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && commaIndex > 0)
        {
            payload = payload[(commaIndex + 1)..];
        }

        if (payload.Length > MaxBase64Length)
        {
            error = "Запись слишком большая (максимум 3 МБ).";
            return null;
        }

        if (!Convert.TryFromBase64String(payload, new byte[payload.Length / 4 * 3 + 3], out var written) || written == 0)
        {
            error = "Некорректная аудиозапись.";
            return null;
        }

        return payload;
    }
}

public class PronunciationCheckRequest
{
    public string? Target { get; set; }
    public string? AudioBase64 { get; set; }
    public string? MimeType { get; set; }
}

public class PronunciationTranscribeRequest
{
    public string? AudioBase64 { get; set; }
    public string? MimeType { get; set; }
}
