using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Интерес пользователя: тема, по которой подбираются новости.
///
/// Отдельная таблица, а не колонка в User: интересов у человека несколько, и
/// они меняются независимо от профиля. Хранение строкой через запятую сделало
/// бы выборку «новости по моим интересам» конкатенацией и не проиндексировалось.
/// </summary>
public class UserInterest
{
    public int Id { get; set; }

    [Required]
    public string UserId { get; set; } = string.Empty;

    /// <summary>
    /// Машинный ключ темы: science, sport, movies, travel, business.
    /// Должен совпадать со значением в <see cref="NewsItem.Topics"/> — иначе
    /// фильтр ничего не найдёт при визуально правильной настройке.
    /// </summary>
    [Required]
    [MaxLength(50)]
    public string Interest { get; set; } = string.Empty;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
}

/// <summary>
/// Справочник доступных интересов.
///
/// Живёт в коде, а не в таблице, потому что список совпадает с рубриками
/// источников и меняется вместе с ними — синхронно с парсером, а не через
/// миграцию. Если появится редактор интересов, справочник переедет в БД вместе
/// с админкой для него.
/// </summary>
public static class Interests
{
    /// <summary>Ключ → подпись для интерфейса.</summary>
    public static readonly IReadOnlyDictionary<string, string> All = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["news"] = "Мировые события",
        ["sport"] = "Спорт",
        ["science"] = "Наука",
        ["tech"] = "Технологии",
        ["business"] = "Бизнес и деньги",
        ["culture"] = "Культура и кино",
        ["travel"] = "Путешествия",
        ["health"] = "Здоровье",
        ["nature"] = "Природа и животные",
        ["interesting"] = "Просто интересное"
    };

    public static bool IsValid(string? interest) =>
        interest != null && All.ContainsKey(interest);

    /// <summary>
    /// Приводит тему источника к нашему ключу.
    ///
    /// Источники пишут по-своему: News in Levels отдаёт рубрики «News» и
    /// «Interesting», BBC — десятки своих, а иногда с уточнением («World news»,
    /// «Science and technology»). Без нормализации фильтр по интересам не
    /// совпадёт никогда, и человек с выбранным «Спорт» увидит пустоту при
    /// десяти спортивных новостях в базе.
    ///
    /// Поэтому сравниваем не строку целиком, а наличие признака в ней: тема
    /// ищется по ведущему слову, а составные рубрики попадают в свою же ветку
    /// («World news» → news, «Science and technology» → science).
    /// </summary>
    public static string Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "interesting";

        var key = raw.Trim().ToLowerInvariant();

        // Порядок важен: «science and technology» должно стать science, а не
        // tech, потому что science стоит раньше в цепочке признаков.
        if (Contains(key, "news", "world", "uk", "politics")) return "news";
        if (Contains(key, "sport", "football", "olympic")) return "sport";
        if (Contains(key, "science")) return "science";
        if (Contains(key, "tech", "computing", "internet", "ai")) return "tech";
        if (Contains(key, "business", "economy", "money", "finance")) return "business";
        if (Contains(key, "culture", "entertainment", "film", "movie", "music", "art")) return "culture";
        if (Contains(key, "travel", "tourism")) return "travel";
        if (Contains(key, "health", "medicine")) return "health";
        if (Contains(key, "nature", "animal", "environment", "climate")) return "nature";

        return "interesting";
    }

    /// <summary>
    /// Найдено ли слово-признак в строке рубрики.
    ///
    /// Не `Contains` по подстроке: «entertainment» содержит «ai» и попадало в
    /// технологии из-за трёх букв. Сравниваем по границам слов, а для коротких
    /// признаков (ai, art, uk) требуем совпадения целиком — иначе они ловят
    /// случайные вхождения внутри других слов.
    /// </summary>
    private static bool Contains(string haystack, params string[] needles)
    {
        var words = haystack.Split(
            new[] { ' ', ',', '.', '-', '/', '&', '|', ':', ';', '(', ')' },
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var needle in needles)
        {
            // Короткие признаки обязаны совпасть со словом целиком.
            if (needle.Length <= 3)
            {
                if (words.Any(w => w == needle)) return true;
                continue;
            }

            // Длинные — совпадают с началом слова: «sports», «sporty» →
            // sport, «animals» → animal.
            if (words.Any(w => w.StartsWith(needle, StringComparison.Ordinal))) return true;
        }

        return false;
    }
}
