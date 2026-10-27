using System.Text.RegularExpressions;

namespace EnglishLearningPlatform.API.Services.Reader;

/// <summary>
/// Осторожное деление текста на предложения. Ошибка здесь не видна глазом,
/// но ломает якорь и перевод фразы, поэтому при сомнении предложение остаётся
/// крупнее: лучше вернуться на строку раньше, чем на соседнюю главу.
/// </summary>
public static class SentenceSplitter
{
    private static readonly HashSet<string> Abbreviations = new(StringComparer.OrdinalIgnoreCase)
    {
        "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "vs.", "etc.",
        "e.g.", "i.e.", "a.m.", "p.m.", "no.", "fig.", "vol.", "ch.", "inc.",
        "ltd.", "co.", "dept.", "approx.", "cf.", "al."
    };

    private static readonly Regex InitialAtEnd = new(@"\b[a-z]\.$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static IReadOnlyList<string> Split(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return Array.Empty<string>();
        }

        var value = Regex.Replace(text, @"\s+", " ").Trim();
        if (value.Length == 0)
        {
            return Array.Empty<string>();
        }

        var result = new List<string>();
        var start = 0;

        for (var index = 0; index < value.Length; index++)
        {
            var current = value[index];
            if (current != '.' && current != '!' && current != '?' && current != '…')
            {
                continue;
            }

            var end = index + 1;
            while (end < value.Length && IsClosingMark(value[end]))
            {
                end++;
            }

            if (current == '.' && IsNonBoundaryPeriod(value, start, index))
            {
                continue;
            }

            if (end < value.Length && !char.IsWhiteSpace(value[end]))
            {
                continue;
            }

            var sentence = value[start..end].Trim();
            if (sentence.Length > 0)
            {
                result.Add(sentence);
            }

            start = end;
            while (start < value.Length && char.IsWhiteSpace(value[start]))
            {
                start++;
            }
        }

        var tail = value[start..].Trim();
        if (tail.Length > 0)
        {
            result.Add(tail);
        }

        return result.Count > 0 ? result : new[] { value };
    }

    private static bool IsClosingMark(char value) =>
        value is '"' or '\'' or '\u201D' or '\u2019' or ')' or ']' or '»';

    private static bool IsNonBoundaryPeriod(string value, int sentenceStart, int periodIndex)
    {
        // Десятичное число: 3.14 — не конец.
        if (periodIndex > 0 && periodIndex + 1 < value.Length &&
            char.IsDigit(value[periodIndex - 1]) && char.IsDigit(value[periodIndex + 1]))
        {
            return true;
        }

        var before = value[sentenceStart..(periodIndex + 1)].Trim();
        var lastSpace = before.LastIndexOf(' ');
        var lastWord = (lastSpace >= 0 ? before[(lastSpace + 1)..] : before).ToLowerInvariant();

        if (Abbreviations.Contains(lastWord))
        {
            return true;
        }

        // Инициалы и аббревиатуры вроде U.S.A.: буква + точка внутри фразы.
        return InitialAtEnd.IsMatch(before);
    }
}
