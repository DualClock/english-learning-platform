using EnglishLearningPlatform.API.Models;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Помощник для расчёта «сегодня» в часовом поясе пользователя.
/// Стрик и дневная цель должны считать день по местному времени,
/// иначе у пользователей UTC+3 вечером начинается «новый день» и стрик ломается.
/// </summary>
public static class UserTime
{
    public static TimeZoneInfo Resolve(string? timeZoneId)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId)) return TimeZoneInfo.Utc;

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    /// <summary>Локальная дата пользователя (без времени).</summary>
    public static DateTime Today(User user)
    {
        var zone = Resolve(user.TimeZoneId);
        return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone).Date;
    }

    /// <summary>
    /// Начало локального дня пользователя в UTC.
    /// Нужно для сравнений с колонками timestamptz (Npgsql требует UTC).
    /// </summary>
    public static DateTime StartOfDayUtc(User user)
    {
        var zone = Resolve(user.TimeZoneId);
        var localDate = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone).Date;
        var unspecified = DateTime.SpecifyKind(localDate, DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(unspecified, zone);
    }

    /// <summary>
    /// Проверяет и нормализует идентификатор часового пояса.
    /// Возвращает null, если пояс неизвестен или слишком длинный.
    /// </summary>
    public static string? Normalize(string? timeZoneId)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId)) return null;

        var trimmed = timeZoneId.Trim();
        if (trimmed.Length > 100) return null;

        try
        {
            TimeZoneInfo.FindSystemTimeZoneById(trimmed);
            return trimmed;
        }
        catch (TimeZoneNotFoundException)
        {
            return null;
        }
        catch (InvalidTimeZoneException)
        {
            return null;
        }
    }
}
