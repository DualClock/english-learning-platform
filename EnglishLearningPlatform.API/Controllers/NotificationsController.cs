using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/notifications")]
[Authorize]
public class NotificationsController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly ReminderService _reminders;
    private readonly IWebHostEnvironment _environment;

    public NotificationsController(
        ApplicationDbContext context,
        ReminderService reminders,
        IWebHostEnvironment environment)
    {
        _context = context;
        _reminders = reminders;
        _environment = environment;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    // GET: api/notifications/outbox — журнал писем пользователя
    [HttpGet("outbox")]
    public async Task<IActionResult> GetOutbox([FromQuery] int limit = 20)
    {
        var userId = GetUserId();
        var take = Math.Clamp(limit, 1, 100);

        var messages = await _context.EmailMessages
            .AsNoTracking()
            .Where(m => m.UserId == userId)
            .OrderByDescending(m => m.CreatedAt)
            .Take(take)
            .Select(m => new
            {
                m.Id,
                m.Subject,
                m.Kind,
                m.Transport,
                m.Delivered,
                m.Error,
                m.CreatedAt,
                preview = m.Body.Length > 300 ? m.Body.Substring(0, 300) + "…" : m.Body
            })
            .ToListAsync();

        return Ok(messages);
    }

    // POST: api/notifications/test — собрать и отправить тестовое напоминание
    [HttpPost("test")]
    public async Task<IActionResult> SendTest()
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == GetUserId());
        if (user == null) return NotFound();

        if (string.IsNullOrWhiteSpace(user.Email))
        {
            return BadRequest(new { message = "У аккаунта не указан email" });
        }

        var result = await _reminders.SendTestAsync(user);

        return Ok(new
        {
            delivered = result.Delivered,
            transport = result.Transport,
            error = result.Error,
            message = result.Transport == "log"
                ? "SMTP не настроен — письмо сохранено в журнал"
                : result.Delivered
                    ? "Письмо отправлено"
                    : "Не удалось отправить письмо"
        });
    }

    // POST: api/notifications/run-now — прогнать планировщик вручную (только Development)
    [HttpPost("run-now")]
    public async Task<IActionResult> RunNow()
    {
        if (!_environment.IsDevelopment())
        {
            return NotFound();
        }

        var sent = await _reminders.RunScheduledAsync();
        return Ok(new { sent });
    }
}
