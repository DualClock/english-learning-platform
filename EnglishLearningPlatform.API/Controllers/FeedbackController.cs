using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

public record FeedbackRequest(
    string? Type,
    string? Message,
    string? Contact,
    string? PagePath,
    string? Website);

/// <summary>
/// Обратная связь беты. Письмо уходит на Feedback:ToEmail (фолбэк — Email:From),
/// а копия остаётся в EmailMessages с Kind = "feedback": отдельная таблица
/// и миграция для отзывов не нужны. Читать копии — GET /api/feedback с X-Seed-Key.
/// </summary>
[ApiController]
[Route("api/feedback")]
public class FeedbackController : ControllerBase
{
    private static readonly HashSet<string> AllowedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "idea",
        "problem",
        "other"
    };

    private readonly EmailSender _emailSender;
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<FeedbackController> _logger;

    public FeedbackController(
        EmailSender emailSender,
        ApplicationDbContext context,
        IConfiguration configuration,
        IWebHostEnvironment environment,
        ILogger<FeedbackController> logger)
    {
        _emailSender = emailSender;
        _context = context;
        _configuration = configuration;
        _environment = environment;
        _logger = logger;
    }

    [HttpPost]
    [EnableRateLimiting("feedback")]
    public async Task<IActionResult> Submit([FromBody] FeedbackRequest request, CancellationToken cancellationToken)
    {
        // Honeypot: скрытое поле заполняют только боты. Отвечаем как обычно,
        // чтобы не подсказывать им, что фильтр сработал.
        if (!string.IsNullOrWhiteSpace(request.Website))
        {
            return Ok(new { ok = true });
        }

        var type = (request.Type ?? string.Empty).Trim().ToLowerInvariant();
        if (!AllowedTypes.Contains(type))
        {
            return BadRequest(new { message = "Неизвестный тип отзыва." });
        }

        var message = (request.Message ?? string.Empty).Trim();
        if (message.Length < 10)
        {
            return BadRequest(new { message = "Сообщение слишком короткое — напишите хотя бы пару фраз." });
        }

        if (message.Length > 2000)
        {
            message = message[..2000];
        }

        var contact = TrimTo(request.Contact, 200);
        var pagePath = TrimTo(request.PagePath, 300);
        var userAgent = TrimTo(Request.Headers.UserAgent.ToString(), 300);
        var userEmail = TrimTo(User.FindFirstValue(ClaimTypes.Email), 320);
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        var recipient = _configuration["Feedback:ToEmail"];
        if (string.IsNullOrWhiteSpace(recipient))
        {
            recipient = _configuration["Email:From"];
        }
        if (string.IsNullOrWhiteSpace(recipient))
        {
            recipient = "feedback@lexicon.local";
        }

        var typeLabel = type switch
        {
            "idea" => "Идея",
            "problem" => "Проблема",
            _ => "Другое"
        };

        var subject = $"[Lexicon · бета] {typeLabel}: {Shorten(message, 60)}";
        var body =
            $"Тип: {typeLabel}{Environment.NewLine}" +
            $"Страница: {(string.IsNullOrWhiteSpace(pagePath) ? "не указана" : pagePath)}{Environment.NewLine}" +
            $"Пользователь: {(string.IsNullOrWhiteSpace(userEmail) ? "не авторизован" : userEmail)}{Environment.NewLine}" +
            $"Контакт: {(string.IsNullOrWhiteSpace(contact) ? "не оставлен" : contact)}{Environment.NewLine}" +
            $"Браузер: {(string.IsNullOrWhiteSpace(userAgent) ? "не указан" : userAgent)}{Environment.NewLine}" +
            $"Дата (UTC): {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}{Environment.NewLine}{Environment.NewLine}" +
            message;

        var result = await _emailSender.SendAsync(
            userId,
            recipient.Trim(),
            subject,
            body,
            "feedback",
            cancellationToken);

        _logger.LogInformation(
            "Отзыв беты: тип {Type}, страница {Page}, пользователь {User}, доставка {Transport}/{Delivered}",
            type,
            pagePath,
            userEmail ?? "аноним",
            result.Transport,
            result.Delivered);

        // Письмо могло не уйти (SMTP), но копия уже сохранена в EmailMessages —
        // поэтому для тестера отправка всё равно успешна.
        return Ok(new { ok = true });
    }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromHeader(Name = "X-Seed-Key")] string? seedKey,
        [FromQuery] int limit = 100,
        CancellationToken cancellationToken = default)
    {
        var configuredKey = _configuration["Seeder:Key"];
        if (!string.IsNullOrEmpty(configuredKey))
        {
            if (seedKey != configuredKey)
            {
                return Unauthorized(new { message = "Неверный ключ доступа." });
            }
        }
        else if (!_environment.IsDevelopment())
        {
            return Forbid();
        }

        var take = Math.Clamp(limit, 1, 200);
        var items = await _context.EmailMessages
            .AsNoTracking()
            .Where(m => m.Kind == "feedback")
            .OrderByDescending(m => m.CreatedAt)
            .Take(take)
            .Select(m => new
            {
                m.Id,
                m.Subject,
                m.Body,
                m.CreatedAt,
                m.Delivered,
                m.To
            })
            .ToListAsync(cancellationToken);

        return Ok(items);
    }

    private static string? TrimTo(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    private static string Shorten(string value, int maxLength)
    {
        var singleLine = value.ReplaceLineEndings(" ");
        return singleLine.Length <= maxLength ? singleLine : singleLine[..maxLength] + "…";
    }
}
