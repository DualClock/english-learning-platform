using System.Text;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Оценка произношения без второго AI-вызова: распознанный текст сравниваем
/// с эталоном по Левенштейну и по словам. Дёшево, детерминированно и
/// объяснимо — ученику видно, какие именно слова «прозвучали» иначе.
/// </summary>
public class PronunciationService
{
    private const double CorrectThreshold = 0.85;
    private const double WordThreshold = 0.80;

    public PronunciationEvaluation Evaluate(string target, string transcribed)
    {
        var cleanTarget = Normalize(target);
        var cleanTranscript = Normalize(transcribed);

        if (cleanTranscript.Length == 0)
        {
            return new PronunciationEvaluation(
                Transcribed: transcribed?.Trim() ?? string.Empty,
                Similarity: 0,
                Correct: false,
                Advice: "Речь не распознана. Запишите ещё раз, ближе к микрофону и без пауз.",
                Mismatches: new List<PronunciationMismatch>());
        }

        var similarity = Similarity(cleanTarget, cleanTranscript);
        var mismatches = FindMismatches(cleanTarget, cleanTranscript);
        var advice = BuildAdvice(similarity, mismatches);

        return new PronunciationEvaluation(
            Transcribed: transcribed?.Trim() ?? string.Empty,
            Similarity: (int)Math.Round(similarity * 100),
            Correct: similarity >= CorrectThreshold,
            Advice: advice,
            Mismatches: mismatches);
    }

    private static List<PronunciationMismatch> FindMismatches(string target, string transcribed)
    {
        var targetWords = Split(target);
        var heardWords = Split(transcribed);
        var mismatches = new List<PronunciationMismatch>();

        for (var i = 0; i < targetWords.Length; i++)
        {
            var expected = targetWords[i];
            var heard = i < heardWords.Length ? heardWords[i] : string.Empty;

            if (Similarity(expected, heard) < WordThreshold)
            {
                mismatches.Add(new PronunciationMismatch(expected, heard));
            }
        }

        // Лишние слова в конце — тоже сигнал, но не отдельная ошибка по слову
        return mismatches;
    }

    private static string BuildAdvice(double similarity, List<PronunciationMismatch> mismatches)
    {
        var baseAdvice = similarity switch
        {
            >= 0.95 => "Отличное произношение — вас понял бы носитель.",
            >= CorrectThreshold => "Хорошо: слово узнаваемо, работайте над беглостью.",
            >= 0.6 => "Понятно, но с искажениями. Прослушайте образец и повторите медленно, по слогам.",
            _ => "Пока далеко от цели. Разбейте слово на слоги и повторяйте за образцом."
        };

        if (mismatches.Count == 0)
        {
            return baseAdvice;
        }

        var builder = new StringBuilder(baseAdvice);
        builder.Append(" Обратите внимание: ");

        var preview = mismatches.Take(3).Select(m =>
            m.Heard.Length == 0
                ? $"«{m.Expected}» не прозвучало"
                : $"«{m.Expected}» прозвучало как «{m.Heard}»");

        builder.Append(string.Join("; ", preview));
        builder.Append('.');

        return builder.ToString();
    }

    internal static string Normalize(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(text.Length);
        var lastWasSpace = true;

        foreach (var ch in text.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch) || ch == '\'')
            {
                builder.Append(ch);
                lastWasSpace = false;
            }
            else if (!lastWasSpace)
            {
                builder.Append(' ');
                lastWasSpace = true;
            }
        }

        return builder.ToString().Trim();
    }

    private static string[] Split(string normalized) =>
        normalized.Length == 0 ? Array.Empty<string>() : normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries);

    /// <summary>Похожесть 0..1 по расстоянию Левенштейна.</summary>
    internal static double Similarity(string a, string b)
    {
        if (a.Length == 0 && b.Length == 0) return 1;
        if (a.Length == 0 || b.Length == 0) return 0;

        var distance = Levenshtein(a, b);
        var max = Math.Max(a.Length, b.Length);
        return Math.Max(0, 1.0 - (double)distance / max);
    }

    internal static int Levenshtein(string a, string b)
    {
        if (a == b) return 0;
        if (a.Length == 0) return b.Length;
        if (b.Length == 0) return a.Length;

        var previous = new int[b.Length + 1];
        var current = new int[b.Length + 1];

        for (var j = 0; j <= b.Length; j++)
        {
            previous[j] = j;
        }

        for (var i = 1; i <= a.Length; i++)
        {
            current[0] = i;
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                current[j] = Math.Min(
                    Math.Min(current[j - 1] + 1, previous[j] + 1),
                    previous[j - 1] + cost);
            }

            (previous, current) = (current, previous);
        }

        return previous[b.Length];
    }
}

public record PronunciationMismatch(string Expected, string Heard);

public record PronunciationEvaluation(
    string Transcribed,
    int Similarity,
    bool Correct,
    string Advice,
    List<PronunciationMismatch> Mismatches);
