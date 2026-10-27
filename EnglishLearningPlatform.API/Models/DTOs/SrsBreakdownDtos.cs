namespace EnglishLearningPlatform.API.Models.DTOs;

/// <summary>
/// Распределение словаря по интервалам повторения — то, что видно на `/progress`.
/// Считается одним SQL-агрегатом: у активного пользователя 4–5 тысяч слов и
/// тянуть их в память ради пяти счётчиков незачем.
/// </summary>
public class SrsBreakdownDto
{
    /// <summary>Сумма по всем бакетам.</summary>
    public int TotalWords { get; set; }

    /// <summary>Ещё не закреплено: «Забыл» или learning step (&lt; 1 дня).</summary>
    public int Learning { get; set; }

    /// <summary>1–7 дней — первое настоящее повторение.</summary>
    public int Short { get; set; }

    /// <summary>8–30 дней — слово держится в памяти неделю и больше.</summary>
    public int Medium { get; set; }

    /// <summary>&gt; 30 дней — почти выучено.</summary>
    public int Long { get; set; }

    /// <summary>Leech: 4+ срыва. Пересекается с бакетами интервала, поэтому не входит в сумму.</summary>
    public int Leech { get; set; }

    /// <summary>Интервал &gt; 21 дня — «знаю надёжно».</summary>
    public int ReliableCount { get; set; }

    /// <summary>Просрочено по текущий момент (как в очереди повторения).</summary>
    public int DueToday { get; set; }

    /// <summary>Срок наступает после текущего момента и до конца завтрашнего дня.</summary>
    public int DueTomorrow { get; set; }

    /// <summary>Порог «надёжно», чтобы подпись в интерфейсе не расходилась с числом.</summary>
    public int ReliableIntervalDays { get; set; }

    public Dictionary<string, int> Buckets { get; set; } = new();
}
