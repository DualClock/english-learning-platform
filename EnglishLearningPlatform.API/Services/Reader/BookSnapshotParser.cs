using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;
using VersOne.Epub;

namespace EnglishLearningPlatform.API.Services.Reader;

/// <summary>
/// Разбирает EPUB в структуру читалки: главы → блоки → предложения + картинки.
/// HTML наружу не отдаётся, поэтому чужая разметка не попадает в DOM.
/// </summary>
public sealed class BookSnapshotParser
{
    public const int ParserVersion = 1;

    private const int MaxChapterWords = 12_000;

    private static readonly Regex WordPattern = new(
        @"[A-Za-z]+(?:['’\-][A-Za-z]+)*",
        RegexOptions.Compiled);

    private static readonly Regex ServiceTitle = new(
        @"^(contents?|table of contents|оглавление|содержание|cover|обложка|title page|титульный лист|copyright)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly HashSet<string> BlockTags = new(StringComparer.OrdinalIgnoreCase)
    {
        "p", "div", "section", "article", "main", "header", "footer", "aside", "nav",
        "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li", "ul", "ol", "pre",
        "figure", "figcaption", "table", "tr", "td", "th", "hr", "img"
    };

    private readonly ReaderAssetService _assets;
    private readonly ILogger<BookSnapshotParser> _logger;

    public BookSnapshotParser(ReaderAssetService assets, ILogger<BookSnapshotParser> logger)
    {
        _assets = assets;
        _logger = logger;
    }

    public async Task<ReaderSnapshot> ParseAsync(
        string filePath,
        string contentHash,
        CancellationToken cancellationToken = default)
    {
        var epub = await EpubReader.ReadBookAsync(filePath);
        var imageMap = BuildImageMap(epub);
        var navigation = BuildNavigationMap(epub);
        var bookTitle = Collapse(epub.Title);
        var chapters = new List<ReaderChapter>();

        for (var spineIndex = 0; spineIndex < epub.ReadingOrder.Count; spineIndex++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var spineItem = epub.ReadingOrder[spineIndex];
            if (string.IsNullOrWhiteSpace(spineItem.Content))
            {
                continue;
            }

            var rawBlocks = await ExtractBlocksAsync(
                spineItem.Content,
                spineItem.FilePath,
                imageMap,
                contentHash,
                cancellationToken);

            rawBlocks = TrimGutenberg(rawBlocks);
            var blocks = BuildBlocks(rawBlocks);
            if (blocks.Count == 0)
            {
                continue;
            }

            var (navTitle, navLevel) = FindNavigationTitle(navigation, spineItem.FilePath);
            var title = CleanTitle(navTitle) ??
                        blocks.FirstOrDefault(b => b.Type == ReaderBlockTypes.Heading)?.Sentences
                            .FirstOrDefault()?.Text ??
                        $"Глава {spineIndex + 1}";

            RemoveRepeatedOpeningHeading(blocks, title);

            var parts = PartitionBlocks(blocks);
            var hash = ShortHash(spineItem.FilePath);
            var partNumber = 0;

            foreach (var part in parts)
            {
                partNumber++;
                var meaningful = part.Any(b => b.Type == ReaderBlockTypes.Image) ||
                                 part.Sum(b => b.Sentences.Sum(s => s.WordCount)) >= 10;
                if (!meaningful)
                {
                    continue;
                }

                var chapter = new ReaderChapter
                {
                    Id = BuildChapterId(spineIndex, hash, partNumber),
                    Title = partNumber == 1 ? title : $"{title} · {partNumber}",
                    Level = navLevel,
                    Blocks = part
                };

                chapters.Add(chapter);
            }
        }

        RemoveFrontMatter(chapters, bookTitle);
        if (chapters.Count == 0)
        {
            throw new InvalidOperationException("EPUB не содержит читаемого текста.");
        }

        var wordCursor = ReassignWordStarts(chapters);
        _logger.LogInformation(
            "Reader snapshot: {Chapters} chapters, {Words} words, hash {Hash}",
            chapters.Count, wordCursor, contentHash);

        return new ReaderSnapshot
        {
            ParserVersion = ParserVersion,
            WordCount = wordCursor,
            Chapters = chapters
        };
    }

    /// <summary>
    /// Титул, обложка и «содержание» часто приходят отдельными короткими
    /// главами. Если книга не состоит из одной такой главы, убираем их, чтобы
    /// читалка открывалась на настоящем тексте. Слова удалённых глав не
    /// попадают в прогресс.
    /// </summary>
    private static void RemoveFrontMatter(List<ReaderChapter> chapters, string bookTitle)
    {
        if (chapters.Count <= 1)
        {
            return;
        }

        for (var index = chapters.Count - 1; index >= 0; index--)
        {
            var chapter = chapters[index];
            if (chapter.Blocks.Any(b => b.Type == ReaderBlockTypes.Image))
            {
                continue;
            }

            var words = chapter.Blocks.Sum(b => b.Sentences.Sum(s => s.WordCount));
            var title = Collapse(chapter.Title);
            var sameAsBook = bookTitle.Length > 0 &&
                             string.Equals(
                                 CollapseLetters(title),
                                 CollapseLetters(bookTitle),
                                 StringComparison.OrdinalIgnoreCase);
            var serviceTitle = ServiceTitle.IsMatch(title);

            if (words < 200 && (sameAsBook || serviceTitle))
            {
                chapters.RemoveAt(index);
            }
        }
    }

    private static int ReassignWordStarts(List<ReaderChapter> chapters)
    {
        var cursor = 0;
        foreach (var chapter in chapters)
        {
            chapter.WordStart = cursor;
            foreach (var sentence in chapter.Blocks.SelectMany(b => b.Sentences))
            {
                sentence.WordStart = cursor;
                cursor += sentence.WordCount;
            }

            chapter.WordCount = cursor - chapter.WordStart;
        }

        return cursor;
    }

    private static string CollapseLetters(string value) =>
        new(value.Where(char.IsLetter).Select(char.ToLowerInvariant).ToArray());

    private static string BuildChapterId(int spineIndex, string hash, int partNumber) =>
        partNumber == 1
            ? $"c{spineIndex:D2}-{hash}"
            : $"c{spineIndex:D2}-{hash}-p{partNumber}";

    private static string ShortHash(string value) =>
        Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(value)))[..8].ToLowerInvariant();

    private static List<List<ReaderBlock>> PartitionBlocks(List<ReaderBlock> blocks)
    {
        var parts = new List<List<ReaderBlock>>();
        var current = new List<ReaderBlock>();
        var currentWords = 0;

        foreach (var block in blocks)
        {
            var blockWords = block.Sentences.Sum(s => s.WordCount);
            if (current.Count > 0 && currentWords + blockWords > MaxChapterWords)
            {
                parts.Add(current);
                current = new List<ReaderBlock>();
                currentWords = 0;
            }

            current.Add(block);
            currentWords += blockWords;
        }

        if (current.Count > 0)
        {
            parts.Add(current);
        }

        return parts;
    }

    private static void RemoveRepeatedOpeningHeading(List<ReaderBlock> blocks, string title)
    {
        if (blocks.Count == 0 || blocks[0].Type != ReaderBlockTypes.Heading)
        {
            return;
        }

        var heading = string.Join(' ', blocks[0].Sentences.Select(s => s.Text)).Trim();
        if (string.Equals(Collapse(heading), Collapse(title), StringComparison.OrdinalIgnoreCase))
        {
            blocks.RemoveAt(0);
        }
    }

    private static List<ReaderBlock> BuildBlocks(List<RawBlock> rawBlocks)
    {
        var blocks = new List<ReaderBlock>();
        var blockIndex = 0;

        foreach (var raw in rawBlocks)
        {
            if (raw.Type == ReaderBlockTypes.Image)
            {
                blocks.Add(new ReaderBlock
                {
                    Id = $"b{blockIndex}",
                    Type = raw.Type,
                    Asset = raw.Asset,
                    Alt = raw.Alt,
                    Caption = raw.Caption,
                    Width = raw.Width,
                    Height = raw.Height
                });
                blockIndex++;
                continue;
            }

            if (raw.Type == ReaderBlockTypes.Separator)
            {
                blocks.Add(new ReaderBlock { Id = $"b{blockIndex}", Type = raw.Type });
                blockIndex++;
                continue;
            }

            var texts = raw.Type == ReaderBlockTypes.Verse
                ? (raw.Text ?? string.Empty).Split('\n', StringSplitOptions.RemoveEmptyEntries)
                : SentenceSplitter.Split(raw.Text);

            var sentences = new List<ReaderSentence>();
            foreach (var text in texts)
            {
                var clean = Collapse(text);
                if (clean.Length < 2)
                {
                    continue;
                }

                var wordCount = WordPattern.Matches(clean).Count;
                if (wordCount == 0)
                {
                    continue;
                }

                sentences.Add(new ReaderSentence
                {
                    Id = $"s{blockIndex}-{sentences.Count}",
                    Text = clean,
                    WordCount = wordCount
                });
            }

            if (sentences.Count > 0)
            {
                blocks.Add(new ReaderBlock
                {
                    Id = $"b{blockIndex}",
                    Type = raw.Type,
                    Sentences = sentences
                });
            }

            blockIndex++;
        }

        return blocks;
    }

    private async Task<List<RawBlock>> ExtractBlocksAsync(
        string html,
        string chapterPath,
        IReadOnlyDictionary<string, byte[]> images,
        string contentHash,
        CancellationToken cancellationToken)
    {
        // <br> без пробела склеивает слова: заменяем на пробел до разбора.
        var prepared = Regex.Replace(html, @"<br\s*/?>", " ", RegexOptions.IgnoreCase);
        var document = new HtmlParser().ParseDocument(prepared);
        var blocks = new List<RawBlock>();
        var root = document.Body ?? document.DocumentElement;

        if (root != null)
        {
            await WalkAsync(root, chapterPath, images, contentHash, blocks, cancellationToken);
        }

        return blocks;
    }

    private async Task WalkAsync(
        INode node,
        string chapterPath,
        IReadOnlyDictionary<string, byte[]> images,
        string contentHash,
        List<RawBlock> target,
        CancellationToken cancellationToken)
    {
        foreach (var child in node.ChildNodes)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (child is not IElement element)
            {
                continue;
            }

            var tag = element.LocalName.ToLowerInvariant();
            switch (tag)
            {
                case "script":
                case "style":
                case "noscript":
                case "head":
                case "nav":
                    continue;

                case "h1":
                case "h2":
                case "h3":
                case "h4":
                case "h5":
                case "h6":
                    AddText(target, ReaderBlockTypes.Heading, element.TextContent);
                    break;

                case "p":
                    AddText(target, ReaderBlockTypes.Paragraph, element.TextContent);
                    await AddImagesAsync(element, chapterPath, images, contentHash, target, cancellationToken);
                    break;

                case "blockquote":
                    AddText(target, ReaderBlockTypes.Quote, element.TextContent);
                    await AddImagesAsync(element, chapterPath, images, contentHash, target, cancellationToken);
                    break;

                case "li":
                    AddText(target, ReaderBlockTypes.ListItem, element.TextContent);
                    break;

                case "pre":
                    AddVerse(target, element.TextContent);
                    break;

                case "figure":
                {
                    var image = element.QuerySelector("img");
                    if (image != null)
                    {
                        var caption = element.QuerySelector("figcaption")?.TextContent;
                        await AddImageAsync(
                            image, chapterPath, images, contentHash, target, caption, cancellationToken);
                    }
                    else
                    {
                        await WalkAsync(element, chapterPath, images, contentHash, target, cancellationToken);
                    }

                    break;
                }

                case "img":
                    await AddImageAsync(
                        element, chapterPath, images, contentHash, target, null, cancellationToken);
                    break;

                case "hr":
                    target.Add(new RawBlock(ReaderBlockTypes.Separator));
                    break;

                case "ul":
                case "ol":
                    await WalkAsync(element, chapterPath, images, contentHash, target, cancellationToken);
                    break;

                case "table":
                    AddText(target, ReaderBlockTypes.Paragraph, element.TextContent);
                    break;

                case "div":
                case "section":
                case "article":
                case "main":
                case "header":
                case "footer":
                case "aside":
                case "body":
                case "html":
                    if (HasBlockChild(element))
                    {
                        await WalkAsync(element, chapterPath, images, contentHash, target, cancellationToken);
                    }
                    else
                    {
                        AddText(target, ReaderBlockTypes.Paragraph, element.TextContent);
                        await AddImagesAsync(element, chapterPath, images, contentHash, target, cancellationToken);
                    }

                    break;

                default:
                    if (HasBlockChild(element))
                    {
                        await WalkAsync(element, chapterPath, images, contentHash, target, cancellationToken);
                    }
                    else if (!string.IsNullOrWhiteSpace(element.TextContent))
                    {
                        AddText(target, ReaderBlockTypes.Paragraph, element.TextContent);
                    }

                    break;
            }
        }
    }

    private static bool HasBlockChild(IElement element) =>
        element.Children.Any(child => BlockTags.Contains(child.LocalName));

    private static void AddText(List<RawBlock> target, string type, string? text)
    {
        var clean = Collapse(text);
        if (clean.Length >= 2)
        {
            target.Add(new RawBlock(type, clean));
        }
    }

    private static void AddVerse(List<RawBlock> target, string? text)
    {
        var clean = (text ?? string.Empty)
            .Replace("\r\n", "\n")
            .Replace('\r', '\n')
            .Split('\n')
            .Select(line => line.TrimEnd())
            .Where(line => !string.IsNullOrWhiteSpace(line))
            .Select(line => line.Trim())
            .ToList();

        if (clean.Count > 0)
        {
            target.Add(new RawBlock(ReaderBlockTypes.Verse, string.Join('\n', clean)));
        }
    }

    private async Task AddImagesAsync(
        IElement container,
        string chapterPath,
        IReadOnlyDictionary<string, byte[]> images,
        string contentHash,
        List<RawBlock> target,
        CancellationToken cancellationToken)
    {
        foreach (var image in container.QuerySelectorAll("img"))
        {
            await AddImageAsync(
                image, chapterPath, images, contentHash, target, null, cancellationToken);
        }
    }

    private async Task AddImageAsync(
        IElement image,
        string chapterPath,
        IReadOnlyDictionary<string, byte[]> images,
        string contentHash,
        List<RawBlock> target,
        string? caption,
        CancellationToken cancellationToken)
    {
        var src = image.GetAttribute("src");
        if (string.IsNullOrWhiteSpace(src) ||
            src.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var resolved = ResolvePath(chapterPath, src);
        if (resolved == null)
        {
            return;
        }

        var bytes = FindImage(images, resolved);
        if (bytes == null)
        {
            return;
        }

        var saved = await _assets.SaveImageAsync(
            contentHash, resolved, bytes, cancellationToken);
        if (saved == null)
        {
            return;
        }

        var alt = Collapse(image.GetAttribute("alt"));
        var cleanCaption = Collapse(caption);
        target.Add(new RawBlock(
            ReaderBlockTypes.Image,
            Asset: saved.Value.Name,
            Alt: alt.Length > 0 ? alt : null,
            Caption: cleanCaption.Length > 0 ? cleanCaption : null,
            Width: saved.Value.Width,
            Height: saved.Value.Height));
    }

    private static Dictionary<string, byte[]> BuildImageMap(EpubBook book)
    {
        var map = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var image in book.Content.Images.Local)
        {
            if (image.Content is not { Length: > 0 })
            {
                continue;
            }

            foreach (var key in PathKeys(image.FilePath))
            {
                map.TryAdd(key, image.Content);
            }
        }

        return map;
    }

    private static byte[]? FindImage(IReadOnlyDictionary<string, byte[]> images, string resolvedPath)
    {
        if (images.TryGetValue(resolvedPath, out var exact))
        {
            return exact;
        }

        var fileName = Path.GetFileName(resolvedPath);
        return images.TryGetValue(fileName, out var byName) ? byName : null;
    }

    private static string? ResolvePath(string chapterPath, string src)
    {
        try
        {
            var baseUri = new Uri("https://epub.local/" + chapterPath.Replace('\\', '/'));
            var resolved = new Uri(baseUri, src);
            if (!string.Equals(resolved.Host, "epub.local", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            return NormalizePath(Uri.UnescapeDataString(resolved.AbsolutePath));
        }
        catch
        {
            return null;
        }
    }

    private static IEnumerable<string> PathKeys(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            yield break;
        }

        var normalized = NormalizePath(path.Replace('\\', '/'));
        yield return normalized;
        yield return Path.GetFileName(normalized);
        yield return Uri.UnescapeDataString(normalized);
    }

    private static string NormalizePath(string path)
    {
        var clean = path.Replace('\\', '/').TrimStart('/');
        while (clean.StartsWith("./", StringComparison.Ordinal))
        {
            clean = clean[2..];
        }

        return clean;
    }

    private static Dictionary<string, (string Title, int Level)> BuildNavigationMap(EpubBook book)
    {
        var map = new Dictionary<string, (string Title, int Level)>(StringComparer.OrdinalIgnoreCase);

        void Walk(List<EpubNavigationItem>? items, int level)
        {
            if (items == null)
            {
                return;
            }

            foreach (var item in items)
            {
                var title = item.Title?.Trim();
                var path = item.HtmlContentFile?.FilePath ?? item.Link?.ContentFilePath;
                if (!string.IsNullOrWhiteSpace(path) && !string.IsNullOrWhiteSpace(title))
                {
                    foreach (var key in PathKeys(path))
                    {
                        map.TryAdd(key, (title, level));
                    }
                }

                Walk(item.NestedItems, level + 1);
            }
        }

        Walk(book.Navigation, 0);
        return map;
    }

    private static (string? Title, int Level) FindNavigationTitle(
        IReadOnlyDictionary<string, (string Title, int Level)> navigation,
        string chapterPath)
    {
        foreach (var key in PathKeys(chapterPath))
        {
            if (navigation.TryGetValue(key, out var found))
            {
                return (found.Title, found.Level);
            }
        }

        return (null, 0);
    }

    private static string? CleanTitle(string? title)
    {
        var clean = Collapse(title);
        return clean.Length > 0 && !ServiceTitle.IsMatch(clean) ? clean : null;
    }

    private static List<RawBlock> TrimGutenberg(List<RawBlock> blocks)
    {
        const string startMarker = "*** START OF THE PROJECT GUTENBERG EBOOK";
        const string endMarker = "*** END OF THE PROJECT GUTENBERG EBOOK";

        var startIndex = blocks.FindIndex(b =>
            b.Text?.Contains(startMarker, StringComparison.OrdinalIgnoreCase) == true);
        if (startIndex >= 0)
        {
            var block = blocks[startIndex];
            var marker = block.Text!.IndexOf(startMarker, StringComparison.OrdinalIgnoreCase);
            var close = block.Text.IndexOf("***", marker + startMarker.Length, StringComparison.Ordinal);
            var rest = close >= 0 ? block.Text[(close + 3)..].Trim() : string.Empty;
            blocks = blocks[startIndex..];
            blocks[0] = block with { Text = rest };
        }

        var endIndex = blocks.FindIndex(b =>
            b.Text?.Contains(endMarker, StringComparison.OrdinalIgnoreCase) == true);
        if (endIndex >= 0)
        {
            var block = blocks[endIndex];
            var marker = block.Text!.IndexOf(endMarker, StringComparison.OrdinalIgnoreCase);
            var before = block.Text[..marker].Trim();
            blocks = blocks[..endIndex];
            if (before.Length > 0)
            {
                blocks.Add(block with { Text = before });
            }
        }

        return blocks
            .Where(b => b.Type == ReaderBlockTypes.Image ||
                        b.Type == ReaderBlockTypes.Separator ||
                        !string.IsNullOrWhiteSpace(b.Text))
            .ToList();
    }

    private static string Collapse(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        return Regex.Replace(text.Replace('\u00AD', '\0'), @"\s+", " ")
            .Replace("\0", string.Empty)
            .Trim();
    }

    private sealed record RawBlock(
        string Type,
        string? Text = null,
        string? Asset = null,
        string? Alt = null,
        string? Caption = null,
        int? Width = null,
        int? Height = null);
}
