using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace EnglishLearningPlatform.API.Tests.Reader;

/// <summary>
/// Маленький, но настоящий EPUB: контейнер, OPF, навигация, две главы и PNG.
/// Тесты парсера должны видеть ту же структуру, что и настоящая книга.
/// </summary>
internal static class TestEpub
{
    public static (string FilePath, string RelativePath, string Hash) Create(
        string contentRoot,
        bool gutenbergMarkers = false)
    {
        var booksDir = Path.Combine(contentRoot, "uploads", "books");
        Directory.CreateDirectory(booksDir);
        var fileName = $"reader-{Guid.NewGuid():N}.epub";
        var path = Path.Combine(booksDir, fileName);

        using (var stream = File.Create(path))
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create))
        {
            AddText(zip, "mimetype", "application/epub+zip", CompressionLevel.NoCompression);
            AddText(zip, "META-INF/container.xml", ContainerXml);
            AddText(zip, "OEBPS/content.opf", ContentOpf);
            AddText(zip, "OEBPS/nav.xhtml", NavXhtml);
            AddText(zip, "OEBPS/Text/chapter1.xhtml", ChapterOne(gutenbergMarkers));
            AddText(zip, "OEBPS/Text/chapter2.xhtml", ChapterTwo(gutenbergMarkers));
            AddBytes(zip, "OEBPS/Images/pixel.png", MakePng());
        }

        var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
        return (path, fileName, hash);
    }

    public static byte[] MakePng()
    {
        using var image = new Image<Rgba32>(10, 10);
        for (var y = 0; y < image.Height; y++)
        {
            for (var x = 0; x < image.Width; x++)
            {
                image[x, y] = new Rgba32(196, 112, 58, 255);
            }
        }

        using var output = new MemoryStream();
        image.SaveAsPng(output);
        return output.ToArray();
    }

    private const string ContainerXml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles>
            <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
          </rootfiles>
        </container>
        """;

    private const string ContentOpf = """
        <?xml version="1.0" encoding="UTF-8"?>
        <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:identifier id="bookid">reader-test</dc:identifier>
            <dc:title>Reader Test Book</dc:title>
            <dc:language>en</dc:language>
            <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
          </metadata>
          <manifest>
            <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
            <item id="ch1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/>
            <item id="ch2" href="Text/chapter2.xhtml" media-type="application/xhtml+xml"/>
            <item id="img" href="Images/pixel.png" media-type="image/png"/>
          </manifest>
          <spine>
            <itemref idref="ch1"/>
            <itemref idref="ch2"/>
          </spine>
        </package>
        """;

    private const string NavXhtml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
          <head><title>Contents</title></head>
          <body>
            <nav epub:type="toc">
              <ol>
                <li><a href="Text/chapter1.xhtml">Chapter One</a></li>
                <li><a href="Text/chapter2.xhtml">Chapter Two</a></li>
              </ol>
            </nav>
          </body>
        </html>
        """;

    private static string ChapterOne(bool gutenbergMarkers)
    {
        var start = gutenbergMarkers
            ? "<p>License junk that must disappear.</p><p>*** START OF THE PROJECT GUTENBERG EBOOK TEST ***</p>"
            : string.Empty;

        return $$"""
            <?xml version="1.0" encoding="UTF-8"?>
            <html xmlns="http://www.w3.org/1999/xhtml">
              <head>
                <title>Chapter One</title>
                <style>.hidden { color: red; }</style>
              </head>
              <body>
                {{start}}
                <h1>The Beginning</h1>
                <p>Mr. Smith walked to the river. He carried a letter. <em>It was raining.</em></p>
                <blockquote>“A short quote.”</blockquote>
                <figure>
                  <img src="../Images/pixel.png" alt="A tiny pixel"/>
                  <figcaption>A tiny image</figcaption>
                </figure>
                <pre>line one
            line two</pre>
                <p>3.14 is a number. The U.S.A. is large. No space.after dot.</p>
                <ul>
                  <li>First item.</li>
                  <li>Second item.</li>
                </ul>
                <script>alert('secret')</script>
              </body>
            </html>
            """;
    }

    private static string ChapterTwo(bool gutenbergMarkers)
    {
        var end = gutenbergMarkers
            ? "<p>*** END OF THE PROJECT GUTENBERG EBOOK TEST ***</p><p>Footer junk that must disappear.</p>"
            : string.Empty;

        return $$"""
            <?xml version="1.0" encoding="UTF-8"?>
            <html xmlns="http://www.w3.org/1999/xhtml">
              <head><title>Chapter Two</title></head>
              <body>
                <h1>The Next Part</h1>
                <p>They walked home. The river was quiet.</p>
                {{end}}
              </body>
            </html>
            """;
    }

    private static void AddText(ZipArchive zip, string name, string content, CompressionLevel level = CompressionLevel.Optimal)
    {
        var entry = zip.CreateEntry(name, level);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(content);
    }

    private static void AddBytes(ZipArchive zip, string name, byte[] content)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
        using var stream = entry.Open();
        stream.Write(content);
    }
}
