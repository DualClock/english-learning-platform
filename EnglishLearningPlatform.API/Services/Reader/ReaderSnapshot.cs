namespace EnglishLearningPlatform.API.Services.Reader;

/// <summary>
/// Структура книги, которую читает фронтенд. Это не HTML: только блоки,
/// предложения, картинки и посчитанные слова. IDs стабильны, пока не меняется
/// версия парсера.
/// </summary>
public sealed class ReaderSnapshot
{
    public int ParserVersion { get; set; }

    public int WordCount { get; set; }

    public List<ReaderChapter> Chapters { get; set; } = new();
}

public sealed class ReaderChapter
{
    public string Id { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public int Level { get; set; }

    /// <summary>Сколько слов книги стоит до начала главы.</summary>
    public int WordStart { get; set; }

    public int WordCount { get; set; }

    public List<ReaderBlock> Blocks { get; set; } = new();
}

public sealed class ReaderBlock
{
    public string Id { get; set; } = string.Empty;

    /// <summary>heading, paragraph, quote, listItem, verse, image, separator.</summary>
    public string Type { get; set; } = "paragraph";

    public List<ReaderSentence> Sentences { get; set; } = new();

    public string? Asset { get; set; }

    public string? Alt { get; set; }

    public string? Caption { get; set; }

    public int? Width { get; set; }

    public int? Height { get; set; }
}

public sealed class ReaderSentence
{
    public string Id { get; set; } = string.Empty;

    public string Text { get; set; } = string.Empty;

    /// <summary>Сколько слов книги стоит до первого слова предложения.</summary>
    public int WordStart { get; set; }

    public int WordCount { get; set; }
}

public static class ReaderBlockTypes
{
    public const string Heading = "heading";
    public const string Paragraph = "paragraph";
    public const string Quote = "quote";
    public const string ListItem = "listItem";
    public const string Verse = "verse";
    public const string Image = "image";
    public const string Separator = "separator";
}
