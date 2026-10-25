namespace EnglishLearningPlatform.API.Models.DTOs;

public sealed class ReaderBookDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Author { get; set; }
    public string? Language { get; set; }
    public string? CoverUrl { get; set; }
    public int WordCount { get; set; }
}

public sealed class ReaderManifestChapterDto
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int Level { get; set; }
    public int WordStart { get; set; }
    public int WordCount { get; set; }
}

public sealed class ReaderPositionDto
{
    public string ChapterId { get; set; } = string.Empty;
    public string SentenceId { get; set; } = string.Empty;
    public int CharOffset { get; set; }
    public double MaxPercent { get; set; }
    public DateTime? FinishedAt { get; set; }
}

public sealed class ReaderBookmarkDto
{
    public int Id { get; set; }
    public int? Page { get; set; }
    public string? ChapterId { get; set; }
    public string? SentenceId { get; set; }
    public int CharOffset { get; set; }
    public string? Excerpt { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class ReaderManifestResponse
{
    public ReaderBookDto Book { get; set; } = new();
    public List<ReaderManifestChapterDto> Manifest { get; set; } = new();
    public ReaderPositionDto Position { get; set; } = new();
    public int PocketCount { get; set; }
    public List<ReaderBookmarkDto> Bookmarks { get; set; } = new();
}

public sealed class ReaderSentenceDto
{
    public string Id { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public int WordStart { get; set; }
    public int WordCount { get; set; }
}

public sealed class ReaderBlockDto
{
    public string Id { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public List<ReaderSentenceDto> Sentences { get; set; } = new();
    public string? Asset { get; set; }
    public string? AssetUrl { get; set; }
    public string? Alt { get; set; }
    public string? Caption { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
}

public sealed class ReaderPocketItemDto
{
    public int Id { get; set; }
    public string Word { get; set; } = string.Empty;
    public string? TranslationRu { get; set; }
    public string? PartOfSpeech { get; set; }
    public string? SentenceId { get; set; }
    public string? SentenceText { get; set; }
    public string? ChapterId { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class ReaderWordStatusDto
{
    public List<string> Known { get; set; } = new();
    public List<string> Learning { get; set; } = new();
    public List<ReaderPocketItemDto> Pocket { get; set; } = new();
}

public sealed class ReaderChapterDifficultyDto
{
    public int TotalWords { get; set; }
    public int KnownWords { get; set; }
    public int LearningWords { get; set; }
    public int NewWords { get; set; }
    public double KnownPercent { get; set; }
}

public sealed class ReaderChapterDto
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int Level { get; set; }
    public int Index { get; set; }
    public int TotalChapters { get; set; }
    public int WordStart { get; set; }
    public int WordCount { get; set; }
    public List<ReaderBlockDto> Blocks { get; set; } = new();
    public ReaderWordStatusDto WordStatus { get; set; } = new();
    public ReaderChapterDifficultyDto Difficulty { get; set; } = new();
}

public sealed class UpdateReaderPositionRequest
{
    public string? ChapterId { get; set; }
    public string? SentenceId { get; set; }
    public int CharOffset { get; set; }
    public int ActiveSeconds { get; set; }
}

public sealed class ReaderPositionResponse
{
    public string ChapterId { get; set; } = string.Empty;
    public string SentenceId { get; set; } = string.Empty;
    public int CharOffset { get; set; }
    public double MaxPercent { get; set; }
    public int WordsRead { get; set; }
    public bool Finished { get; set; }
}

public sealed class UpsertPocketWordRequest
{
    public string? Word { get; set; }
    public string? ChapterId { get; set; }
    public string? SentenceId { get; set; }
    public string? Translation { get; set; }
    public string? PartOfSpeech { get; set; }
}

public sealed class ReaderReviewResponse
{
    public List<ReaderPocketItemDto> Items { get; set; } = new();
}

public sealed class ReaderPocketListResponse
{
    public List<ReaderPocketItemDto> Items { get; set; } = new();
}

public sealed class ReaderSpeechRequest
{
    public List<string> SentenceIds { get; set; } = new();
}

public sealed class ReaderSpeechSegmentDto
{
    public string SentenceId { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
}

public sealed class ReaderSpeechManifestDto
{
    /// <summary>false — ключа Azure нет, клиент сразу берёт голос браузера.</summary>
    public bool Available { get; set; }
    public string Voice { get; set; } = string.Empty;
    public List<ReaderSpeechSegmentDto> Segments { get; set; } = new();
}

public sealed class ReaderFinishRequest
{
    public string? ChapterId { get; set; }
}

public sealed class ReaderWordLookupDto
{
    public string Word { get; set; } = string.Empty;
    public string? CefrLevel { get; set; }
    public string? TranslationRu { get; set; }
    public int? FreqRank { get; set; }
}
