namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Кириллица → латиница для человекочитаемых адресов.
///
/// Слаг из русского заголовка без транслитерации превращается в пустую строку
/// (все буквы отбрасываются как не-ASCII), и два таких материала конфликтуют
/// по пустому слагу. Вынесено из контроллеров в общий сервис: до этого
/// копия жила в AdminContentController, и вторая копия неизбежно разошлась бы
/// с первой (одна знает «ё», другая нет).
/// </summary>
public static class Transliteration
{
    private static readonly Dictionary<char, string> Map = new()
    {
        ['а'] = "a", ['б'] = "b", ['в'] = "v", ['г'] = "g", ['д'] = "d",
        ['е'] = "e", ['ё'] = "e", ['ж'] = "zh", ['з'] = "z", ['и'] = "i",
        ['й'] = "y", ['к'] = "k", ['л'] = "l", ['м'] = "m", ['н'] = "n",
        ['о'] = "o", ['п'] = "p", ['р'] = "r", ['с'] = "s", ['т'] = "t",
        ['у'] = "u", ['ф'] = "f", ['х'] = "h", ['ц'] = "ts", ['ч'] = "ch",
        ['ш'] = "sh", ['щ'] = "sch", ['ъ'] = "", ['ы'] = "y", ['ь'] = "",
        ['э'] = "e", ['ю'] = "yu", ['я'] = "ya",
        // Украинские буквы: платформа многоязычная по интерфейсу, и автор
        // может написать заголовок на украинском.
        ['і'] = "i", ['ї'] = "i", ['є'] = "e", ['ґ'] = "g",
    };

    /// <summary>
    /// Переводит кириллицу в латиницу. Латиница и всё остальное остаются
    /// как есть — вызывающий код сам решает, что делать с прочими символами.
    /// </summary>
    public static string ToLatin(string input)
    {
        if (string.IsNullOrEmpty(input)) return string.Empty;

        var builder = new System.Text.StringBuilder(input.Length);
        foreach (var ch in input.ToLowerInvariant())
        {
            builder.Append(Map.TryGetValue(ch, out var mapped) ? mapped : ch);
        }

        return builder.ToString();
    }
}
