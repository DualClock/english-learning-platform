namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Лига определяется недельным XP, а не суммарным: так новичок не соревнуется
/// с теми, кто копил XP месяцами, и лига честно отражает активность недели.
/// </summary>
public record LeagueDef(string Code, string Title, int MinXp);

public static class LeagueCatalog
{
    public static readonly LeagueDef[] All =
    {
        new("bronze", "Бронза", 0),
        new("silver", "Серебро", 80),
        new("gold", "Золото", 200),
        new("platinum", "Платина", 400),
        new("diamond", "Алмаз", 800)
    };

    public static LeagueDef ResolveCode(string? code)
    {
        return All.FirstOrDefault(l => string.Equals(l.Code, code, StringComparison.OrdinalIgnoreCase)) ?? All[0];
    }

    public static LeagueDef? Next(string code)
    {
        var index = Array.FindIndex(All, l => string.Equals(l.Code, code, StringComparison.OrdinalIgnoreCase));
        return index >= 0 && index + 1 < All.Length ? All[index + 1] : null;
    }

    public static LeagueDef? Previous(string code)
    {
        var index = Array.FindIndex(All, l => string.Equals(l.Code, code, StringComparison.OrdinalIgnoreCase));
        return index > 0 ? All[index - 1] : null;
    }

    public static (LeagueDef current, LeagueDef? next) Resolve(int weeklyXp)
    {
        var current = All[0];
        foreach (var league in All)
        {
            if (weeklyXp >= league.MinXp) current = league;
        }

        var next = All.FirstOrDefault(l => l.MinXp > weeklyXp);
        return (current, next);
    }
}
