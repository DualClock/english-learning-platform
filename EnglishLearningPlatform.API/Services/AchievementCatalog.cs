namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Определение достижения. metric — какой показатель сравниваем с target.
/// </summary>
public record AchievementDef(
    string Code,
    string Title,
    string Description,
    string Icon,
    string Metric,
    int Target);

/// <summary>
/// Каталог достижений. Хранится в коде: сами разблокировки — в таблице UserAchievements.
/// </summary>
public static class AchievementCatalog
{
    public static readonly AchievementDef[] All =
    {
        new("first_word", "Первое слово", "Добавьте первое слово в словарь", "📝", "words", 1),
        new("first_untranslated", "Слово на слух", "Сохраните слово без перевода", "🎧", "untranslated", 1),
        new("bulk_5", "Первая пачка", "Добавьте 5 слов списком", "📥", "bulk", 5),
        new("words_10", "Десяток слов", "10 слов в личном словаре", "🌱", "words", 10),
        new("words_50", "50 слов", "50 слов в личном словаре", "📚", "words", 50),
        new("words_200", "200 слов", "200 слов в личном словаре", "🏛️", "words", 200),
        new("words_500", "500 слов", "500 слов в личном словаре", "🌳", "words", 500),

        new("first_review", "Первое повторение", "Повторите первое слово", "🔁", "reviews", 1),
        new("reviews_10", "Десять повторений", "10 повторений слов", "🔄", "reviews", 10),
        new("reviews_100", "Сотня повторений", "100 повторений слов", "💯", "reviews", 100),
        new("reviews_500", "Мастер повторений", "500 повторений слов", "🧠", "reviews", 500),

        new("first_book", "Первая книга", "Добавьте книгу в библиотеку", "📖", "books", 1),
        new("books_3", "Три книги", "Три книги в библиотеке", "📚", "books", 3),
        new("books_5", "Пять книг", "Пять книг в библиотеке", "🗂️", "books", 5),
        new("pages_10", "Первые десять страниц", "Прочитайте 10 страниц", "📑", "pages", 10),
        new("pages_100", "Сотня страниц", "Прочитайте 100 страниц", "📄", "pages", 100),

        new("first_grammar", "Первый юнит", "Пройдите первый грамматический юнит", "✏️", "grammar", 1),
        new("grammar_5", "Пять юнитов", "5 пройденных юнитов", "📘", "grammar", 5),
        new("grammar_10", "Грамматист", "10 пройденных юнитов", "🎓", "grammar", 10),
        new("grammar_50", "Грамматический марафон", "50 пройденных юнитов", "🏆", "grammar", 50),

        new("streak_3", "Три дня подряд", "Стрик 3 дня", "🔥", "streak", 3),
        new("streak_7", "Неделя силы", "Стрик 7 дней", "⚡", "streak", 7),
        new("streak_30", "Месяц привычки", "Стрик 30 дней", "🌟", "streak", 30),

        new("xp_100", "100 XP", "Заработайте 100 XP", "🌿", "xp", 100),
        new("xp_500", "500 XP", "Заработайте 500 XP", "✨", "xp", 500),
        new("xp_2000", "2000 XP", "Заработайте 2000 XP", "💎", "xp", 2000),

        new("categories_1", "Первый тематический набор", "Выучите первое слово в категориях", "🗂️", "categories", 1),
        new("categories_10", "Тематический старт", "Выучите 10 слов в категориях", "🗃️", "categories", 10),
        new("days_3", "Три дня с целью", "3 дня с выполненной целью", "📆", "days", 3),
        new("days_10", "10 активных дней", "10 дней с выполненной целью", "📅", "days", 10),
    };

    public static AchievementDef? Find(string code) => All.FirstOrDefault(a => a.Code == code);
}

public record LevelDef(int Level, string Title, int MinXp);

/// <summary>Пороги уровней по суммарному XP.</summary>
public static class XpLevels
{
    public static readonly LevelDef[] All =
    {
        new(1, "Новичок", 0),
        new(2, "Ученик", 50),
        new(3, "Читатель", 150),
        new(4, "Книголюб", 300),
        new(5, "Словесник", 500),
        new(6, "Практик", 800),
        new(7, "Знаток", 1200),
        new(8, "Эксперт", 1700),
        new(9, "Мастер", 2300),
        new(10, "Гуру", 3000),
        new(11, "Легенда", 4000),
    };

    public static (LevelDef current, LevelDef? next) Resolve(int xp)
    {
        var current = All[0];
        foreach (var level in All)
        {
            if (xp >= level.MinXp) current = level;
        }

        var next = All.FirstOrDefault(l => l.MinXp > xp);
        return (current, next);
    }
}
