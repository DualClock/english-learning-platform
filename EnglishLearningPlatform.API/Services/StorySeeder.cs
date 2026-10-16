using System.IO.Compression;
using System.Text;
using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;

namespace EnglishLearningPlatform.API.Services;

public class StorySeedData
{
    public string Title { get; set; } = string.Empty;
    public string Author { get; set; } = string.Empty;
    public string CefrLevel { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public List<string> Paragraphs { get; set; } = new();
}

// Градированные рассказы для A1–B1. Сидер сам ничего не создаёт в БД:
// POST /api/books/story/{index} копирует рассказ в книгу текущего пользователя
// (по аналогии с AddPopularBook, дедуп по Title).
public class StorySeeder
{
    private const string SeedFileRelativePath = "Data/Seed/stories.json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<StorySeeder> _logger;

    private List<StorySeedData>? _cachedStories;

    public StorySeeder(
        ApplicationDbContext context,
        IWebHostEnvironment environment,
        ILogger<StorySeeder> logger)
    {
        _context = context;
        _environment = environment;
        _logger = logger;
    }

    private string SeedFilePath => Path.Combine(_environment.ContentRootPath, SeedFileRelativePath);

    public List<StorySeedData> GetStories()
    {
        if (_cachedStories != null)
        {
            return _cachedStories;
        }

        if (!File.Exists(SeedFilePath))
        {
            _logger.LogError("Stories seed file not found: {Path}", SeedFilePath);
            return new List<StorySeedData>();
        }

        try
        {
            using var stream = File.OpenRead(SeedFilePath);
            _cachedStories = JsonSerializer.Deserialize<List<StorySeedData>>(stream, JsonOptions)
                             ?? new List<StorySeedData>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read stories seed file {Path}", SeedFilePath);
            _cachedStories = new List<StorySeedData>();
        }

        return _cachedStories;
    }

    public StorySeedData? GetStory(int index)
    {
        var stories = GetStories();
        return index >= 0 && index < stories.Count ? stories[index] : null;
    }

    // Палитра сайта: пара цветов градиента + цвет текста под свой оттенок рассказа
    private static readonly (string Top, string Bottom, string Text)[] CoverPalette =
    {
        ("#356B52", "#4A7C59", "#E7ECE4"),
        ("#EBCB75", "#C4A77D", "#356B52"),
        ("#4A7C59", "#356B52", "#E7ECE4"),
        ("#C4A77D", "#E7ECE4", "#356B52"),
        ("#356B52", "#E7ECE4", "#EBCB75"),
        ("#4A7C59", "#EBCB75", "#356B52"),
        ("#C4A77D", "#4A7C59", "#E7ECE4"),
        ("#E7ECE4", "#C4A77D", "#356B52")
    };

    // SVG-обложка рассказа 400×600: вертикальный градиент из палитры сайта,
    // крупное название с переносом по словам, автор, декоративная рамка и ✦
    public string GetCoverSvg(int index, StorySeedData story)
    {
        var (top, bottom, text) = CoverPalette[Math.Abs(index) % CoverPalette.Length];

        var titleLines = WrapText(story.Title, maxCharsPerLine: 18, maxLines: 4);
        const int lineHeight = 46;
        var firstLineY = 300 - (titleLines.Count - 1) * lineHeight / 2;

        var titleElements = titleLines
            .Select((line, i) =>
                $"<text x=\"200\" y=\"{firstLineY + i * lineHeight}\" text-anchor=\"middle\" " +
                $"font-family=\"Georgia, 'Times New Roman', serif\" font-size=\"36\" " +
                $"font-weight=\"bold\" fill=\"{text}\">{EscapeXml(line)}</text>");

        return $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
              <defs>
                <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="{top}"/>
                  <stop offset="100%" stop-color="{bottom}"/>
                </linearGradient>
              </defs>
              <rect width="400" height="600" fill="url(#bg)"/>
              <rect x="24" y="24" width="352" height="552" fill="none" stroke="{text}" stroke-opacity="0.5" stroke-width="1.5"/>
              <text x="200" y="120" text-anchor="middle" font-size="30" fill="{text}" fill-opacity="0.85">&#10022;</text>
              <line x1="150" y1="160" x2="250" y2="160" stroke="{text}" stroke-opacity="0.5" stroke-width="1.5"/>
              {string.Join("\n  ", titleElements)}
              <line x1="170" y1="500" x2="230" y2="500" stroke="{text}" stroke-opacity="0.5" stroke-width="1.5"/>
              <text x="200" y="536" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="20" fill="{text}" fill-opacity="0.9">{EscapeXml(story.Author)}</text>
            </svg>
            """;
    }

    // Перенос названия по словам: максимум maxLines строк, лишнее — с многоточием
    private static List<string> WrapText(string text, int maxCharsPerLine, int maxLines)
    {
        var lines = new List<string>();
        var current = string.Empty;

        foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = current.Length == 0 ? word : $"{current} {word}";
            if (candidate.Length > maxCharsPerLine && current.Length > 0)
            {
                lines.Add(current);
                current = word;
            }
            else
            {
                current = candidate;
            }
        }

        if (current.Length > 0)
        {
            lines.Add(current);
        }

        if (lines.Count > maxLines)
        {
            lines = lines.Take(maxLines).ToList();
            var last = lines[^1];
            lines[^1] = (last.Length > maxCharsPerLine - 1
                ? last[..(maxCharsPerLine - 1)].TrimEnd()
                : last) + "…";
        }

        return lines;
    }

    // URL SVG-обложки рассказа: при первом обращении генерирует и сохраняет
    // файл в uploads/covers/story-{index}.svg, дальше файл отдаёт статика
    public string EnsureCoverUrl(int index, StorySeedData story)
    {
        var coversFolder = Path.Combine(_environment.ContentRootPath, "uploads", "covers");
        Directory.CreateDirectory(coversFolder);

        var fileName = $"story-{index}.svg";
        var filePath = Path.Combine(coversFolder, fileName);

        if (!File.Exists(filePath))
        {
            File.WriteAllText(filePath, GetCoverSvg(index, story));
        }

        return $"/uploads/covers/{fileName}";
    }

    // Генерирует EPUB из абзацев рассказа и создаёт Book для пользователя.
    // UploadedByUserId = userId — книга видна только этому пользователю.
    // index нужен для SVG-обложки (uploads/covers/story-{index}.svg).
    public async Task<Book?> CreateBookForUserAsync(string userId, StorySeedData story, int index)
    {
        try
        {
            var uploadsFolder = Path.Combine(_environment.ContentRootPath, "uploads", "books");
            Directory.CreateDirectory(uploadsFolder);

            var fileName = $"{Guid.NewGuid()}.epub";
            var filePath = Path.Combine(uploadsFolder, fileName);

            WriteEpub(story, filePath);

            var book = new Book
            {
                Title = story.Title,
                Author = story.Author,
                Language = "en",
                Description = story.Description,
                CefrLevel = story.CefrLevel,
                FilePath = fileName,
                FileSize = new FileInfo(filePath).Length,
                CoverUrl = EnsureCoverUrl(index, story),
                UploadedByUserId = userId
            };

            _context.Books.Add(book);
            await _context.SaveChangesAsync();

            return book;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create story book {Title}", story.Title);
            return null;
        }
    }

    // Минимальный валидный EPUB: mimetype + container.xml + OPF + EPUB3 nav + главы.
    // VersOne.Epub 3.3.6 умеет только читать, поэтому EPUB собираем ZipArchive-ом.
    private static void WriteEpub(StorySeedData story, string filePath)
    {
        using var stream = new FileStream(filePath, FileMode.Create);
        using var zip = new ZipArchive(stream, ZipArchiveMode.Create);

        // mimetype обязан идти первым и без сжатия
        var mimetype = zip.CreateEntry("mimetype", CompressionLevel.NoCompression);
        using (var writer = new StreamWriter(mimetype.Open(), Encoding.ASCII))
        {
            writer.Write("application/epub+zip");
        }

        var uuid = $"urn:uuid:{Guid.NewGuid()}";

        var container = zip.CreateEntry("META-INF/container.xml");
        using (var writer = new StreamWriter(container.Open(), Encoding.UTF8))
        {
            writer.Write("""
                <?xml version="1.0" encoding="UTF-8"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                  <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                  </rootfiles>
                </container>
                """);
        }

        var chapterHtml = BuildChapterXhtml(story);

        var chapter = zip.CreateEntry("OEBPS/story.xhtml");
        using (var writer = new StreamWriter(chapter.Open(), Encoding.UTF8))
        {
            writer.Write(chapterHtml);
        }

        var nav = zip.CreateEntry("OEBPS/nav.xhtml");
        using (var writer = new StreamWriter(nav.Open(), Encoding.UTF8))
        {
            writer.Write($"""
                <?xml version="1.0" encoding="UTF-8"?>
                <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
                  <head><title>{EscapeXml(story.Title)}</title></head>
                  <body>
                    <nav epub:type="toc">
                      <h1>Contents</h1>
                      <ol>
                        <li><a href="story.xhtml">{EscapeXml(story.Title)}</a></li>
                      </ol>
                    </nav>
                  </body>
                </html>
                """);
        }

        var opf = zip.CreateEntry("OEBPS/content.opf");
        using (var writer = new StreamWriter(opf.Open(), Encoding.UTF8))
        {
            writer.Write($"""
                <?xml version="1.0" encoding="UTF-8"?>
                <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
                  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                    <dc:identifier id="pub-id">{EscapeXml(uuid)}</dc:identifier>
                    <dc:title>{EscapeXml(story.Title)}</dc:title>
                    <dc:creator>{EscapeXml(story.Author)}</dc:creator>
                    <dc:language>en</dc:language>
                    <dc:description>{EscapeXml(story.Description)}</dc:description>
                    <meta property="dcterms:modified">{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ssZ}</meta>
                  </metadata>
                  <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
                    <item id="story" href="story.xhtml" media-type="application/xhtml+xml"/>
                  </manifest>
                  <spine>
                    <itemref idref="story"/>
                  </spine>
                </package>
                """);
        }
    }

    private static string BuildChapterXhtml(StorySeedData story)
    {
        var builder = new StringBuilder();
        builder.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        builder.AppendLine("<html xmlns=\"http://www.w3.org/1999/xhtml\">");
        builder.AppendLine($"  <head><title>{EscapeXml(story.Title)}</title></head>");
        builder.AppendLine("  <body>");
        builder.AppendLine($"    <h1>{EscapeXml(story.Title)}</h1>");
        foreach (var paragraph in story.Paragraphs)
        {
            builder.AppendLine($"    <p>{EscapeXml(paragraph)}</p>");
        }
        builder.AppendLine("  </body>");
        builder.AppendLine("</html>");
        return builder.ToString();
    }

    private static string EscapeXml(string text) =>
        System.Security.SecurityElement.Escape(text) ?? string.Empty;
}
