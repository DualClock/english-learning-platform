using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Security;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Создаёт роли приложения и, если конфиг задаёт адрес, выдаёт Admin этому
/// пользователю.
///
/// Почему через конфиг, а не «первому зарегистрированному»: первый
/// зарегистрированный на чистой базе — это тот, кто первым открыл стенд, а не
/// владелец. Автоматическая выдача прав по порядку регистрации на проде — это
/// способ отдать админку случайному человеку.
///
/// Идемпотентен: повторный старт ничего не дублирует, а потерянную роль
/// восстанавливает.
/// </summary>
public class RoleSeeder
{
    private readonly RoleManager<IdentityRole> _roleManager;
    private readonly UserManager<User> _userManager;
    private readonly IConfiguration _configuration;
    private readonly ILogger<RoleSeeder> _logger;

    public RoleSeeder(
        RoleManager<IdentityRole> roleManager,
        UserManager<User> userManager,
        IConfiguration configuration,
        ILogger<RoleSeeder> logger)
    {
        _roleManager = roleManager;
        _userManager = userManager;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<RoleSeedResult> SeedAsync()
    {
        var result = new RoleSeedResult();

        foreach (var role in new[] { AppRoles.Admin, AppRoles.User })
        {
            if (await _roleManager.RoleExistsAsync(role))
            {
                result.RolesExisting++;
                continue;
            }

            var created = await _roleManager.CreateAsync(new IdentityRole(role));
            if (created.Succeeded)
            {
                result.RolesCreated++;
                _logger.LogInformation("Создана роль {Role}", role);
            }
            else
            {
                result.Error = string.Join(
                    "; ",
                    created.Errors.Select(e => $"{e.Code}: {e.Description}"));
                _logger.LogError("Не удалось создать роль {Role}: {Error}", role, result.Error);
            }
        }

        var bootstrapEmail = _configuration["Admin:BootstrapEmail"];
        if (string.IsNullOrWhiteSpace(bootstrapEmail))
        {
            return result;
        }

        var user = await _userManager.FindByEmailAsync(bootstrapEmail.Trim());
        if (user == null)
        {
            // Адрес указан, но аккаунта ещё нет: например, база пустая.
            // Это не ошибка запуска — человек зарегистрируется и роль получит
            // при следующем старте или через /api/admin/roles/bootstrap.
            result.BootstrapUserId = null;
            _logger.LogWarning(
                "Admin:BootstrapEmail={Email} задан, но пользователь не найден — роль не выдана",
                bootstrapEmail);
            return result;
        }

        result.BootstrapUserId = user.Id;

        if (await _userManager.IsInRoleAsync(user, AppRoles.Admin))
        {
            result.AdminAlreadyAssigned = true;
            return result;
        }

        var assigned = await _userManager.AddToRoleAsync(user, AppRoles.Admin);
        if (assigned.Succeeded)
        {
            result.AdminAssigned = true;
            _logger.LogInformation(
                "Пользователь {Email} ({UserId}) назначен Admin",
                bootstrapEmail, user.Id);
        }
        else
        {
            result.Error = string.Join(
                "; ",
                assigned.Errors.Select(e => $"{e.Code}: {e.Description}"));
            _logger.LogError("Не удалось назначить Admin {Email}: {Error}", bootstrapEmail, result.Error);
        }

        return result;
    }
}

public class RoleSeedResult
{
    public int RolesCreated { get; set; }
    public int RolesExisting { get; set; }
    public string? BootstrapUserId { get; set; }
    public bool AdminAssigned { get; set; }
    public bool AdminAlreadyAssigned { get; set; }
    public string? Error { get; set; }
}
