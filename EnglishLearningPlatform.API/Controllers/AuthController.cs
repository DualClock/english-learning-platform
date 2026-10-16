using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using EnglishLearningPlatform.API.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly UserManager<User> _userManager;
    private readonly IConfiguration _configuration;

    public AuthController(UserManager<User> userManager, IConfiguration configuration)
    {
        _userManager = userManager;
        _configuration = configuration;
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
            DailyGoalMinutes = dto.DailyGoalMinutes ?? 10
        };

        
        var result = await _userManager.CreateAsync(user, dto.Password);

        if (!result.Succeeded)
        {
            return BadRequest(result.Errors);
        }

        var token = GenerateJwtToken(user);

        return Ok(new { token, userId = user.Id, email = user.Email, displayName = user.DisplayName });
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

        var result = await _userManager.CheckPasswordAsync(user, dto.Password);

        if (!result)
        {
            return Unauthorized(new { message = "Invalid email or password" });
        }

        // Генерируем JWT
        var token = GenerateJwtToken(user);

        user.LastLoginAt = DateTime.UtcNow;
        await _userManager.UpdateAsync(user);

        return Ok(new { token, userId = user.Id, email = user.Email, displayName = user.DisplayName });
    }

    // POST: api/auth/forgot-password
    // BETA: SMTP не настроен — токен возвращается в ответе напрямую.
    // ПЕРЕД ПРОДАКШЕНОМ заменить отправкой письма и убрать токен из ответа!
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordDto dto)
    {
        var user = await _userManager.FindByEmailAsync(dto.Email.Trim());
        if (user == null)
        {
            // Не раскрываем существование аккаунта
            return Ok(new { message = "If the account exists, a reset token has been generated." });
        }

        var token = await _userManager.GeneratePasswordResetTokenAsync(user);
        return Ok(new
        {
            message = "Reset token generated.",
            resetToken = token,
            note = "BETA: SMTP не настроен, токен возвращён в ответе. Перед продакшеном — отправка письмом."
        });
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
public record RegisterDto(string Email, string Password, string? DisplayName, string? CefrLevel, string? StudyGoal, int? DailyGoalMinutes);
public record LoginDto(string Email, string Password);
public record ForgotPasswordDto(string Email);
public record ResetPasswordDto(string Email, string ResetToken, string NewPassword);