using System.IO.Compression;
using System.Text;
using EnglishLearningPlatform.API.Services;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// EPUB — это zip. Лимит 50 МБ на сжатый файл не спасает от «бомбы»:
/// маленький архив может развернуться в гигабайты и уронить инстанс.
/// До передачи файла в EpubReader проверяем заявленные размеры записей.
/// </summary>
public class EpubArchiveLimitsTests
{
    private const long OneKb = 1024;

    private static MemoryStream CreateZip(params (string Name, byte[] Data)[] entries)
    {
        var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, data) in entries)
            {
                var entry = archive.CreateEntry(name, CompressionLevel.SmallestSize);
                using var entryStream = entry.Open();
                entryStream.Write(data);
            }
        }

        stream.Position = 0;
        return stream;
    }

    [Fact]
    public void IsArchiveWithinLimits_NormalEpub_ReturnsTrue()
    {
        using var zip = CreateZip(
            ("mimetype", Encoding.ASCII.GetBytes("application/epub+zip")),
            ("content/chapter1.xhtml", Encoding.UTF8.GetBytes(new string('a', 500))));

        Assert.True(BookService.IsArchiveWithinLimits(zip, maxEntryBytes: 10 * OneKb, maxTotalBytes: 100 * OneKb, maxEntries: 100));
    }

    [Fact]
    public void IsArchiveWithinLimits_SingleEntryOverLimit_ReturnsFalse()
    {
        // 10 КБ нулей сжимаются почти в ноль — классическая бомба
        using var zip = CreateZip(("chapter.xhtml", new byte[10 * OneKb]));

        Assert.False(BookService.IsArchiveWithinLimits(zip, maxEntryBytes: 5 * OneKb, maxTotalBytes: 100 * OneKb, maxEntries: 100));
    }

    [Fact]
    public void IsArchiveWithinLimits_TotalExpansionOverLimit_ReturnsFalse()
    {
        using var zip = CreateZip(
            ("a.xhtml", new byte[4 * OneKb]),
            ("b.xhtml", new byte[4 * OneKb]),
            ("c.xhtml", new byte[4 * OneKb]));

        Assert.False(BookService.IsArchiveWithinLimits(zip, maxEntryBytes: 5 * OneKb, maxTotalBytes: 10 * OneKb, maxEntries: 100));
    }

    [Fact]
    public void IsArchiveWithinLimits_TooManyEntries_ReturnsFalse()
    {
        var entries = Enumerable.Range(0, 10)
            .Select(i => ($"part{i}.xhtml", new byte[10]))
            .ToArray();
        using var zip = CreateZip(entries);

        Assert.False(BookService.IsArchiveWithinLimits(zip, maxEntryBytes: OneKb, maxTotalBytes: 100 * OneKb, maxEntries: 5));
    }

    [Fact]
    public void IsArchiveWithinLimits_NotAZip_ReturnsFalse()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("GIF89a not an epub"));

        Assert.False(BookService.IsArchiveWithinLimits(stream, maxEntryBytes: OneKb, maxTotalBytes: OneKb, maxEntries: 10));
    }
}
