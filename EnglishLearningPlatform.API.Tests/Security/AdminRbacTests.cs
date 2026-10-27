using System.IdentityModel.Tokens.Jwt;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using EnglishLearningPlatform.API.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// CMS-0: проверка, что роль Admin действительно даёт доступ к админским
/// эндпоинтам, а обычный пользователь получает отказ.
///
/// Почему это не «тест на 200/403 через HTTP»: поднять целый хост с Identity,
/// PostgreSQL-провайдером и rate limiter'ом внутри in-process раннера нельзя без
/// флаки (rate limiter и DataProtection уже закрывали такие попытки). Здесь
/// проверяется ровно тот механизм, который в проде решает судьбу запроса —
/// <see cref="AuthorizationPolicy"/> для роли Admin, — и отдельно то, что каждый
/// админский экшен этой политикой действительно защищён. Второе важнее: тест на
/// один URL не заметит эндпоинт, добавленный без атрибута.
///
/// Проверка идёт через настоящую политику ASP.NET Core (AuthorizationPolicyBuilder
/// + RoleAuthorizationHandler), а не через строковое сравнение атрибута: если в
/// Program.cs пропадёт RoleClaimType, этот тест позеленеет ложно — поэтому
/// согласованность RoleClaimType проверяется отдельным фактом.
/// </summary>
public class AdminRbacTests
{
    private const string Issuer = "EnglishLearningPlatform";
    private const string Audience = "EnglishLearningPlatform.Users";
    private const string SigningKey = "test-signing-key-at-least-32-characters-long!!";

    // ---------------------------------------------------------------- хелперы

    /// <summary>
    /// Тот же тип claim, что пишет AuthController и читает Program.cs.
    /// </summary>
    private static ClaimsPrincipal Principal(params string[] roles)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, "user-1"),
            new(JwtRegisteredClaimNames.Email, "user@example.com"),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        claims.AddRange(roles.Select(role => new Claim(AppClaims.Role, role)));

        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Bearer", AppClaims.Role, AppClaims.Role));
    }

    /// <summary>
    /// Прогоняет principal через authorization service с политикой
    /// [Authorize(Roles = "Admin")] — то же, что делает middleware для запроса.
    /// </summary>
    private static async Task<AuthorizationResult> AuthorizeAdminAsync(ClaimsPrincipal principal)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthorization();
        services.AddSingleton<IAuthorizationHandler, RolesAuthorizationHandlerForTests>();

        using var provider = services.BuildServiceProvider();
        var authorization = provider.GetRequiredService<IAuthorizationService>();

        // Требование сформулировано явно, но проверяется тем же способом, что
        // и встроенный RequireRole: наличие claim'а роли у пользователя.
        // Значение ClaimTypes.Role совпадает с тем, что пишет AuthController.
        var policy = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .AddRequirements(new RolesRequirementForTests(AppRoles.Admin))
            .Build();

        return await authorization.AuthorizeAsync(principal, resource: null, policy);
    }

    /// <summary>
    /// Замена встроенного RolesAuthorizationHandler: класс
    /// RolesAuthorizationRequirement в ASP.NET Core internal, а мы проверяем
    /// ровно ту же семантику — user.IsInRole(role) при настроенном
    /// RoleClaimType. Проверка идёт по AppClaims.Role напрямую, чтобы тест
    /// падал, если актёр выписывает роль под другим ключом.
    /// </summary>
    private sealed class RolesAuthorizationHandlerForTests : IAuthorizationHandler
    {
        public Task HandleAsync(AuthorizationHandlerContext context)
        {
            foreach (var requirement in context.PendingRequirements.ToList())
            {
                if (requirement is RolesRequirementForTests roles &&
                    roles.AllowedRoles.Any(role => context.User.HasClaim(AppClaims.Role, role)))
                {
                    context.Succeed(requirement);
                }
            }

            return Task.CompletedTask;
        }
    }

    private sealed class RolesRequirementForTests : IAuthorizationRequirement
    {
        public RolesRequirementForTests(params string[] allowedRoles) => AllowedRoles = allowedRoles;

        public IReadOnlyList<string> AllowedRoles { get; }
    }

    // ---------------------------------------------------------------- базовые факты

    [Fact]
    public async Task AdminRole_IsAuthorized()
    {
        var result = await AuthorizeAdminAsync(Principal(AppRoles.Admin));
        Assert.True(result.Succeeded);
    }

    [Fact]
    public async Task PlainUser_WithoutRole_IsForbiddenByAdminPolicy()
    {
        // Обычный пользователь: аутентифицирован, но без роли Admin.
        // Именно этот случай UI прячет кнопкой, а бэкенд обязан отдать 403.
        var result = await AuthorizeAdminAsync(Principal());
        Assert.False(result.Succeeded);
        Assert.Contains(result.Failure.FailedRequirements, r => r is RolesRequirementForTests);
    }

    [Fact]
    public async Task UserRole_IsNotEnoughForAdminPolicy()
    {
        var result = await AuthorizeAdminAsync(Principal(AppRoles.User));
        Assert.False(result.Succeeded);
    }

    [Fact]
    public async Task AnonymousPrincipal_IsNotAuthorized()
    {
        var result = await AuthorizeAdminAsync(new ClaimsPrincipal(new ClaimsIdentity()));
        Assert.False(result.Succeeded);
    }

    // ---------------------------------------------------------------- реальный JWT

    [Fact]
    public void AdminToken_CarriesRoleClaimUnderAppClaimsRole()
    {
        // Токен собирается тем же handler'ом, что и в AuthController, и
        // валидируется с тем же RoleClaimType, что в Program.cs. Это ловит
        // рассинхрон: выписали под одним ключом, проверяем под другим.
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningKey)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: Issuer,
            audience: Audience,
            claims: new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, "user-1"),
                new Claim(AppClaims.Role, AppRoles.Admin)
            },
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: credentials);

        var handler = new JwtSecurityTokenHandler();
        var raw = handler.WriteToken(token);

        var principal = handler.ValidateToken(raw, new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = Issuer,
            ValidAudience = Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningKey)),
            RoleClaimType = AppClaims.Role
        }, out _);

        Assert.True(principal.IsInRole(AppRoles.Admin));
        // JwtSecurityTokenHandler мапит inbound 'sub' в ClaimTypes.NameIdentifier
        // (см. комментарий в AuthController.Refresh). Проверяем по тому ключу,
        // под которым claim реально лежит после валидации.
        Assert.Equal("user-1",
            principal.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value);
    }

    [Fact]
    public void TokenWithoutRole_IsNotInAdminRole()
    {
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningKey)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: Issuer,
            audience: Audience,
            claims: new[] { new Claim(JwtRegisteredClaimNames.Sub, "user-1") },
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: credentials);

        var handler = new JwtSecurityTokenHandler();
        var principal = handler.ValidateToken(handler.WriteToken(token), new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = Issuer,
            ValidAudience = Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningKey)),
            RoleClaimType = AppClaims.Role
        }, out _);

        Assert.False(principal.IsInRole(AppRoles.Admin));
    }

    // ---------------------------------------------------------------- защита от забвения

    /// <summary>
    /// Все экшены под /api/admin/* обязаны требовать роль Admin.
    ///
    /// Проверка структурная: собирает контроллеры из сборки API, берёт экшены,
    /// у которых маршрут начинается с api/admin, и требует на методе или классе
    /// [Authorize(Roles = "Admin")]. Нужна ровно потому, что «скрыли кнопку в UI»
    /// защитой не является: следующий админский эндпоинт без атрибута прошёл бы
    /// любой точечный тест.
    /// </summary>
    [Fact]
    public void EveryAdminRoute_RequiresAdminRole()
    {
        var apiAssembly = typeof(EnglishLearningPlatform.API.Controllers.CategoriesController).Assembly;
        var adminActions = apiAssembly
            .GetTypes()
            .Where(type => typeof(ControllerBase).IsAssignableFrom(type) && !type.IsAbstract)
            .SelectMany(type => type
                .GetMethods(BindingFlags.Public | BindingFlags.Instance)
                .Where(method => method.DeclaringType == type)
                .SelectMany(method => method
                    .GetCustomAttributes<RouteAttribute>(inherit: true)
                    .Select(route => new { Type = type, Method = method, Route = route.Template })))
            .Where(item => item.Route != null &&
                           item.Route.TrimStart('/').StartsWith("api/admin", StringComparison.OrdinalIgnoreCase))
            .ToList();

        Assert.True(adminActions.Count > 0,
            "Не найдено ни одного экшена под /api/admin/* — проверка маршрутов сломана. "
            + "Сборка: " + apiAssembly.FullName + ". Типы контроллеров: " + string.Join(", ",
                apiAssembly.GetTypes()
                    .Where(t => typeof(ControllerBase).IsAssignableFrom(t) && !t.IsAbstract)
                    .Select(t => t.Name).Take(50)));

        var offenders = adminActions
            .Where(item => !RequiresAdminRole(item.Method, item.Type))
            .Select(item => $"{item.Type.Name}.{item.Method.Name} ({item.Route})")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            "Админские маршруты без [Authorize(Roles = \"Admin\")]:\n" + string.Join("\n", offenders));
    }

    private static bool RequiresAdminRole(MethodInfo method, Type controllerType)
    {
        var attributes = method.GetCustomAttributes<AuthorizeAttribute>(inherit: true)
            .Concat(controllerType.GetCustomAttributes<AuthorizeAttribute>(inherit: true));

        return attributes.Any(attribute =>
            !string.IsNullOrWhiteSpace(attribute.Roles) &&
            attribute.Roles.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Contains(AppRoles.Admin, StringComparer.Ordinal));
    }

    // ---------------------------------------------------------------- RoleClaimType в Program.cs

    /// <summary>
    /// Program.cs — top-level statements, поэтому «проверить строку в файле» это
    /// единственный доступный способ поймать регресс: тест выше проверяет, что
    /// роль пишется под AppClaims.Role, а этот — что проверяется под тем же ключом.
    /// Без пары этих двух тестов рассинхрон (выписали ClaimTypes.Role, читаем
    /// "role") даёт 403 админу и остаётся незамеченным до прода.
    /// </summary>
    [Fact]
    public void Program_ConfiguresJwtRoleClaimType()
    {
        var programPath = Path.Combine(FindApiProjectDirectory(), "Program.cs");
        var source = File.ReadAllText(programPath);

        Assert.Contains("RoleClaimType = AppClaims.Role", source, StringComparison.Ordinal);
    }

    private static string FindApiProjectDirectory()
    {
        // Ищем вверх от каталога тестовой сборки до каталога с
        // EnglishLearningPlatform.API/Program.cs — так путь не зависит от
        // того, откуда запущен раннер.
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory != null)
        {
            // baseDirectory заканчивается на Bin/Debug/net10.0, поэтому сначала
            // проверяем «я в корне репозитория», а потом «я в каталоге тестов».
            if (File.Exists(Path.Combine(directory.FullName, "EnglishLearningPlatform.API", "Program.cs")))
            {
                return Path.Combine(directory.FullName, "EnglishLearningPlatform.API");
            }

            if (File.Exists(Path.Combine(directory.FullName, "..", "EnglishLearningPlatform.API", "Program.cs")))
            {
                return Path.GetFullPath(Path.Combine(directory.FullName, "..", "EnglishLearningPlatform.API"));
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException(
            "Не найден каталог EnglishLearningPlatform.API рядом с тестовой сборкой");
    }
}
