using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

public class BookKeyWord
{
    public int Id { get; set; }

    public int BookId { get; set; }
    public Book Book { get; set; } = null!;

    [MaxLength(100)]
    public string WordText { get; set; } = string.Empty;

    [MaxLength(2)]
    public string CefrLevel { get; set; } = "b1";

    public int FreqRank { get; set; }

    public int Page { get; set; }

    public int Frequency { get; set; }
}
