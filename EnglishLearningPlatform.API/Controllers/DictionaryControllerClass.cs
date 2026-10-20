using System.Security.Claims;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DictionaryController : ControllerBase
{
    private readonly DictionaryService _dictionaryService;

    public DictionaryController(DictionaryService dictionaryService)
    {
        _dictionaryService = dictionaryService;
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
        return CreatedAtAction(nameof(GetWord), new { id = word.Id }, word);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<WordResponse>> UpdateWord(int id, UpdateWordRequest request)
    {
        var word = await _dictionaryService.UpdateWordAsync(GetUserId(), id, request);
        if (word == null) return NotFound();
        return Ok(word);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteWord(int id)
    {
        var deleted = await _dictionaryService.DeleteWordAsync(GetUserId(), id);
        if (!deleted) return NotFound();
        return NoContent();
    }
}