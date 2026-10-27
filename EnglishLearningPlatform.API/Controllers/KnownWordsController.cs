using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/known-words")]
[Authorize]
public class KnownWordsController : ControllerBase
{
    private const int MaxWordLength = 100;

    private readonly ApplicationDbContext _context;

    public KnownWordsController(ApplicationDbContext context)
    {
        _context = context;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // GET: api/known-words — слова, которые пользователь отметил знакомыми
    [HttpGet]
    public async Task<IActionResult> GetKnownWords()
    {
        var userId = GetUserId();

        var items = await _context.UserKnownWords.AsNoTracking()
            .Where(k => k.UserId == userId)
            .OrderByDescending(k => k.CreatedAt)
            .Select(k => new { text = k.Text, createdAt = k.CreatedAt })
            .ToListAsync();

        return Ok(new { items, count = items.Count });
    }

    // POST: api/known-words/toggle — переключить слово (знакомо / не знакомо)
    [HttpPost("toggle")]
    public async Task<IActionResult> Toggle([FromBody] KnownWordRequest request)
    {
        var text = Normalize(request?.Text);
        if (text.Length == 0)
        {
            return BadRequest(new { error = "Укажите слово." });
        }

        if (text.Length > MaxWordLength)
        {
            return BadRequest(new { error = $"Слово слишком длинное (максимум {MaxWordLength} символов)." });
        }

        var userId = GetUserId();

        var existing = await _context.UserKnownWords
            .FirstOrDefaultAsync(k => k.UserId == userId && k.Text == text);

        var known = existing == null;

        if (existing != null)
        {
            _context.UserKnownWords.Remove(existing);
        }
        else
        {
            _context.UserKnownWords.Add(new UserKnownWord
            {
                UserId = userId,
                Text = text
            });
        }

        await _context.SaveChangesAsync();

        // Доля знакомых слов пересчитывается при следующем запросе сложности
        ReaderDifficultyService.InvalidateUser(userId);

        return Ok(new { text, known });
    }

    private static string Normalize(string? text)
    {
        var clean = (text ?? string.Empty).Trim().ToLowerInvariant();
        // Отрезаем притяжательное 's: "speaker's" -> "speaker"
        if (clean.EndsWith("'s", StringComparison.Ordinal))
        {
            clean = clean[..^2];
        }

        return clean.Trim('\'', '"', '.', ',', '!', '?', ';', ':');
    }
}

public class KnownWordRequest
{
    public string? Text { get; set; }
}
