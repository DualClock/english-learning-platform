namespace EnglishLearningPlatform.API.Security;

/// <summary>
/// Имена ролей Identity. Роль живёт в таблицах AspNetRoles/AspNetUserRoles,
/// которые уже созданы, но до CMS-0 нигде не заполнялись и не проверялись.
///
/// Права разделены так:
///   Admin — всё: контент, категории, публикация, импорт, AI-ассистент.
///   User  — обычный пользователь; неявен (нет строки в AspNetUserRoles),
///           но описан константой, чтобы сравнения не были строковыми литералами.
/// </summary>
public static class AppRoles
{
    public const string Admin = "Admin";
    public const string User = "User";
}

/// <summary>
/// Тип claim, в котором едет роль.
///
/// Почему ClaimTypes.Role, а не короткое "role": JwtSecurityTokenHandler по
/// умолчанию маппит inbound-claims, и "role" превратился бы в
/// http://schemas.microsoft.com/ws/2008/06/identity/claims/role — то есть
/// [Authorize(Roles = "Admin")] всё равно бы работал, но только потому, что
/// маппинг включён. Явный URI читается одинаково и при MapInboundClaims=true,
/// и при false, поэтому в проекте роль всегда едет под этим ключом.
/// </summary>
public static class AppClaims
{
    public const string Role = System.Security.Claims.ClaimTypes.Role;
}
