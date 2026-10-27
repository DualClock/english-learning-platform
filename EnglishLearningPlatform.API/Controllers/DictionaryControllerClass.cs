using System.Security.Claims;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DictionaryController : ControllerBase
{
    private readonly DictionaryService _dictionaryService;
    private readonly AchievementService _achievementService;
    private readonly ILogger<DictionaryController> _logger;

    public DictionaryController(
        DictionaryService dictionaryService,
        AchievementService achievementService,
        ILogger<DictionaryController> logger)
    {
        _dictionaryService = dictionaryService;
        _achievementService = achievementService;
        _logger = logger;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    [HttpGet]
    public async Task<ActionResult<object>> GetWords([FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var (items, totalCount) = await _dictionaryService.GetUserWordsAsync(GetUserId(), page, pageSize);

        return Ok(new
        {
            items,
            page,
            pageSize,
            totalCount,
            totalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
        });
    }

    [HttpGet("search")]
    public async Task<ActionResult<List<WordResponse>>> Search([FromQuery] string query)
    {
        var words = await _dictionaryService.SearchWordsAsync(GetUserId(), query);
        return Ok(words);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<WordResponse>> GetWord(int id)
    {
        var word = await _dictionaryService.GetWordAsync(GetUserId(), id);
        if (word == null) return NotFound();
        return Ok(word);
    }

    [HttpPost]
    public async Task<ActionResult<WordResponse>> AddWord(AddWordRequest request)
    {
        var source = string.IsNullOrWhiteSpace(request.Source) ? "manual" : request.Source;
        var word = await _dictionaryService.AddWordAsync(GetUserId(), request, source);
        if (word == null) return Conflict(new { message = "Word already added" });

        // Достижение «слово без перевода» лучше зафиксировать сразу на сервере:
        // к моменту следующей проверки пользователь уже может добавить перевод.
        if (word.Definitions.Count == 0)
        {
            try
            {
                await _achievementService.GetProgressAsync(GetUserId());
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Не удалось проверить достижения после добавления слова");
            }
        }

        return CreatedAtAction(nameof(GetWord), new { id = word.Id }, word);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<WordResponse>> UpdateWord(int id, UpdateWordRequest request)
    {
        var word = await _dictionaryService.UpdateWordAsync(GetUserId(), id, request);
        if (word == null) return NotFound();
        return Ok(word);
    }

    [HttpPut("{id}/emoji")]
    public async Task<ActionResult<WordResponse>> SetEmoji(int id, [FromBody] SetWordEmojiRequest request)
    {
        if (!WordVisualCatalog.IsAllowedEmoji(request.Emoji))
        {
            return BadRequest(new { message = "Выберите эмодзи из набора" });
        }

        var (word, removedImage) = await _dictionaryService.SetEmojiAsync(
            GetUserId(),
            id,
            request.Emoji);

        if (word == null) return NotFound();
        WordImageService.DeleteUploadedImage(removedImage);
        return Ok(word);
    }

    [HttpPost("{id}/image")]
    [EnableRateLimiting("upload")]
    public async Task<ActionResult<WordResponse>> UploadImage(int id, IFormFile? file)
    {
        if (file == null || file.Length == 0)
        {
            return BadRequest(new { message = "Выберите изображение" });
        }

        string newUrl;
        try
        {
            await using var stream = file.OpenReadStream();
            newUrl = await WordImageService.SaveUploadedImageAsync(stream, file.Length);
        }
        catch (WordImageValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }

        var (word, removedImage) = await _dictionaryService.SetImageAsync(GetUserId(), id, newUrl);

        if (word == null)
        {
            WordImageService.DeleteUploadedImage(newUrl);
            return NotFound();
        }

        WordImageService.DeleteUploadedImage(removedImage);
        return Ok(word);
    }

    [HttpDelete("{id}/visual")]
    public async Task<IActionResult> ClearVisual(int id)
    {
        var (cleared, removedImage) = await _dictionaryService.ClearVisualAsync(GetUserId(), id);
        if (!cleared) return NotFound();
        WordImageService.DeleteUploadedImage(removedImage);
        return NoContent();
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteWord(int id)
    {
        var userId = GetUserId();
        var existing = await _dictionaryService.GetWordAsync(userId, id);
        var deleted = await _dictionaryService.DeleteWordAsync(userId, id);
        if (!deleted) return NotFound();
        WordImageService.DeleteUploadedImage(existing?.ImageUrl);
        return NoContent();
    }
}

public record SetWordEmojiRequest(string? Emoji);