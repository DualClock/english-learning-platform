using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace EnglishLearningPlatform.API.Models;

/// <summary>Итог недели для одного участника: лига, место и переход.</summary>
public class LeagueHistory
{
    public long Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    [Column(TypeName = "date")]
    public DateTime WeekStart { get; set; }

    [MaxLength(20)]
    public string League { get; set; } = "bronze";

    public int Rank { get; set; }

    public int Participants { get; set; }

    public int WeeklyXp { get; set; }

    /// <summary>promoted | held | demoted | forming</summary>
    [MaxLength(20)]
    public string Outcome { get; set; } = "held";

    [MaxLength(20)]
    public string NextLeague { get; set; } = "bronze";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User? User { get; set; }
}
