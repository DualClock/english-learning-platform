using System.ComponentModel.DataAnnotations.Schema;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Одна строка-состояние: до какой недели включительно лиги уже пересчитаны.
/// Позволяет закрывать неделю лениво, при первом запросе после понедельника.
/// </summary>
public class LeagueWeekState
{
    public int Id { get; set; } = 1;

    [Column(TypeName = "date")]
    public DateTime LastProcessedWeekStart { get; set; }
}
