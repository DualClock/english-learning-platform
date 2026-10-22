using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[EnableRateLimiting("auth")]
public class AuthController : ControllerBase
{
    private readonly UserManager<User> _userManager;
    private readonly IConfiguration _configuration;
    private readonly AuthEmailService _authEmail;
    private readonly ILogger<AuthController> _logger;
    private readonly IMemoryCache _cache;

    // Пауза между письмами на один адрес: защита от email-бомбинга
    private static readonly TimeSpan AuthEmailCooldown = TimeSpan.FromMinutes(5);

    public AuthController(
        UserManager<User> userManager,
        IConfiguration configuration,
        AuthEmailService authEmail,
        ILogger<AuthController> logger,
        IMemoryCache cache)
    {
        _userManager = userManager;
        _configuration = configuration;
        _authEmail = authEmail;
        _logger = logger;
        _cache = cache;
    }

    private bool TryAcquireEmailSendSlot(string kind, string email)
    {
        var key = $"auth-email:{kind}:{email.Trim().ToLowerInvariant()}";
        if (_cache.TryGetValue(key, out _))
        {
            return false;
        }

        _cache.Set(key, true, AuthEmailCooldown);
        return true;
    }

    // POST: api/auth/register
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterDto dto)
    {
        var email = dto.Email.Trim();

        var user = new User
        {
            UserName = email,
            Email = email,
            DisplayName = dto.DisplayName?.Trim(),
            CefrLevel = dto.CefrLevel,
            StudyGoal = dto.StudyGoal,
            DailyGoalMinutes = Math.Clamp(dto.DailyGoalMinutes ?? 10, 1, 240),
            TimeZoneId = UserTime.Normalize(dto.TimeZoneId),
            NotifyEnabled = dto.NotifyEnabled ?? false,
            ReminderHour = Math.Clamp(dto.ReminderHour ?? 9, 0, 23),
            // Если пользователь пропустит выбор аватара, остаётся базовый по умолчанию
            AvatarUrl = AvatarService.DefaultAvatarUrl("avatar-1")
        };


        var result = await _userManager.CreateAsync(user, dto.Password);

        if (!result.Succeeded)
        {
            return BadRequest(result.Errors);
        }

        var token = GenerateJwtToken(user);

        // Письмо-подтверждение не должно ломать регистрацию: если SMTP недоступен,
        // пользователь всё равно попадёт в приложение и сможет переслать письмо позже.
        try
        {
            var confirmToken = await _userManager.GenerateEmailConfirmationTokenAsync(user);
            await _authEmail.SendEmailConfirmationAsync(user, confirmToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Не удалось отправить письмо-подтверждение для {UserId}", user.Id);
        }

        return Ok(new
        {
            token,
            userId = user.Id,
            email = user.Email,
            displayName = user.DisplayName,
            avatarUrl = user.AvatarUrl,
            emailConfirmed = user.EmailConfirmed
        });
    }

    // POST: api/auth/login
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginDto dto)
    {
        var user = await _userManager.FindByEmailAsync(dto.Email.Trim());

        if (user == null)
        {
            return Unauthorized(new { message = "Invalid email or password" });
        }

        // Заблокированный аккаунт: сообщение то же, что и при неверном пароле,
        // чтобы не раскрывать существование аккаунта перебором почт.
        if (await _userManager.IsLockedOutAsync(user))
        {
            _logger.LogWarning("Попытка входа в заблокированный аккаунт: {UserId}", user.Id);
            return Unauthorized(new { message = "Invalid email or password" });
        }

        var result = await _userManager.CheckPasswordAsync(user, dto.Password);

        if (!result)
        {
            // Считаем неудачу: после MaxFailedAccessAttempts аккаунт блокируется
            // на DefaultLockoutTimeSpan, и перебор пароля перестаёт работать.
            await _userManager.AccessFailedAsync(user);
            return Unauthorized(new { message = "Invalid email or password" });
        }

        // Успешный вход сбрасывает счётчик неудач
        await _userManager.ResetAccessFailedCountAsync(user);

        // Генерируем JWT
        var token = GenerateJwtToken(user);

        user.LastLoginAt = DateTime.UtcNow;
        await _userManager.UpdateAsync(user);

        return Ok(new
        {
            token,
            userId = user.Id,
            email = user.Email,
            displayName = user.DisplayName,
            avatarUrl = user.AvatarUrl,
            emailConfirmed = user.EmailConfirmed
        });
    }

    // POST: api/auth/forgot-password
    // Токен уходит письмом. В ответе его нет ни в Development, ни в Production —
    // иначе сброс пароля зависел бы от того, настроен ли SMTP.
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordDto dto)
    {
        const string neutral = "Если аккаунт существует, письмо со ссылкой уже отправлено.";

        if (string.IsNullOrWhiteSpace(dto.Email))
        {
            return Ok(new { message = neutral });
        }

        var user = await _userManager.FindByEmailAsync(dto.Email.Trim());
        if (user == null)
        {
            // Не раскрываем существование аккаунта
            return Ok(new { message = neutral });
        }

        // Один адрес получает письмо не чаще раза в 5 минут
        if (!TryAcquireEmailSendSlot("password-reset", user.Email ?? dto.Email))
        {
            return Ok(new { message = neutral });
        }

        var token = await _userManager.GeneratePasswordResetTokenAsync(user);
        await _authEmail.SendPasswordResetAsync(user, token);

        return Ok(new { message = neutral });
    }

    // POST: api/auth/confirm-email
    // Принимает токен из письма и подтверждает адрес.
    [HttpPost("confirm-email")]
    public async Task<IActionResult> ConfirmEmail([FromBody] ConfirmEmailDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Token))
        {
            return BadRequest(new { message = "Ссылка неполная — запросите письмо заново." });
        }

        var user = await _userManager.FindByEmailAsync(dto.Email.Trim());
        if (user == null)
        {
            return BadRequest(new { message = "Ссылка недействительна или устарела." });
        }

        if (await _userManager.IsEmailConfirmedAsync(user))
        {
            return Ok(new { message = "Email уже подтверждён.", alreadyConfirmed = true });
        }

        var result = await _userManager.ConfirmEmailAsync(user, dto.Token);
        if (!result.Succeeded)
        {
            return BadRequest(new { message = "Ссылка недействительна или устарела. Запросите письмо заново." });
        }

        return Ok(new { message = "Email подтверждён. Спасибо!" });
    }

    // POST: api/auth/resend-confirmation — повторное письмо для вошедшего пользователя
    [HttpPost("resend-confirmation")]
    [Authorize]
    public async Task<IActionResult> ResendConfirmation()
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var user = userId == null ? null : await _userManager.FindByIdAsync(userId);

        if (user == null) return Unauthorized();
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            return BadRequest(new { message = "У аккаунта не указан email." });
        }

        if (await _userManager.IsEmailConfirmedAsync(user))
        {
            return Ok(new { message = "Email уже подтверждён.", alreadyConfirmed = true });
        }

        if (!TryAcquireEmailSendSlot("confirm-email", user.Email))
        {
            return Ok(new { message = "Письмо уже отправлено недавно — проверьте почту." });
        }

        var token = await _userManager.GenerateEmailConfirmationTokenAsync(user);
        await _authEmail.SendEmailConfirmationAsync(user, token);

        return Ok(new { message = "Письмо отправлено — проверьте почту." });
    }

    // POST: api/auth/reset-password
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordDto dto)
    {
        var user = await _userManager.FindByEmailAsync(dto.Email.Trim());
        if (user == null)
        {
            return BadRequest(new { message = "Invalid request" });
        }

        var result = await _userManager.ResetPasswordAsync(user, dto.ResetToken, dto.NewPassword);
        if (!result.Succeeded)
        {
            return BadRequest(new
            {
                message = "Password reset failed",
                errors = result.Errors.Select(e => e.Description).ToArray()
            });
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _userManager.UpdateAsync(user);
        return Ok(new { message = "Password reset successfully" });
    }

    private string GenerateJwtToken(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_configuration["Jwt:Key"]!));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id),
            new Claim(JwtRegisteredClaimNames.Email, user.Email!),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var token = new JwtSecurityToken(
            issuer: _configuration["Jwt:Issuer"],
            audience: _configuration["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(Convert.ToDouble(_configuration["Jwt:ExpiryMinutes"])),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

// DTOs
public record RegisterDto(
    [property: Required, EmailAddress, MaxLength(256)] string Email,
    [property: Required, MaxLength(128)] string Password,
    [property: MaxLength(100)] string? DisplayName,
    [property: MaxLength(10)] string? CefrLevel,
    [property: MaxLength(200)] string? StudyGoal,
    int? DailyGoalMinutes,
    [property: MaxLength(64)] string? TimeZoneId = null,
    bool? NotifyEnabled = null,
    int? ReminderHour = null);
public record LoginDto(
    [property: Required, EmailAddress, MaxLength(256)] string Email,
    [property: Required, MaxLength(128)] string Password);
public record ForgotPasswordDto(
    [property: Required, EmailAddress, MaxLength(256)] string Email);
public record ResetPasswordDto(
    [property: Required, EmailAddress, MaxLength(256)] string Email,
    [property: Required, MaxLength(200)] string ResetToken,
    [property: Required, MaxLength(128)] string NewPassword);
public record ConfirmEmailDto(
    [property: Required, EmailAddress, MaxLength(256)] string Email,
    [property: Required, MaxLength(200)] string Token);