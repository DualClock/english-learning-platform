using System.ComponentModel.DataAnnotations.Schema;

namespace EnglishLearningPlatform.API.Models;

public class DailyActivity
{
    public int Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    [Column(TypeName = "date")]
    public DateTime Date { get; set; }

    public int MinutesRead { get; set; } = 0;

    public int WordsReviewed { get; set; } = 0;

    public int QuizzesDone { get; set; } = 0;

    public bool GoalMet { get; set; } = false;

    public User User { get; set; } = null!;
}
