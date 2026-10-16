using System.Text.RegularExpressions;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Анализ текста книги: частотность слов, уровни CEFR по справочнику WordLevels,
/// маркерные слова для читалки. Работает без AI — только локальная таблица WordLevels.
/// </summary>
public class BookAnalyzerService
{
    private const int MinRank = 150;   // совсем базовые слова (the, of...) не маркерные
    private const int MaxRank = 4500;  // дальше — редкие/служебные, в справочник не входят
    private const int TopPerPage = 15;

    private readonly ApplicationDbContext _context;
    private readonly BookService _bookService;
    private readonly ILogger<BookAnalyzerService> _logger;

    public BookAnalyzerService(
        ApplicationDbContext context,
        BookService bookService,
        ILogger<BookAnalyzerService> logger)
    {
        _context = context;
        _bookService = bookService;
        _logger = logger;
    }

    public async Task AnalyzeAsync(int bookId)
    {
        var book = await _context.Books.FirstOrDefaultAsync(b => b.Id == bookId);
        if (book == null) return;

        var pages = await _bookService.GetPagesAsync(bookId);
        if (pages == null)
        {
            _logger.LogWarning("Analyzer: no pages for book {BookId}", bookId);
            return;
        }

        var levels = await _context.WordLevels.AsNoTracking()
            .Where(wl => wl.FreqRank >= MinRank && wl.FreqRank <= MaxRank)
            .Select(wl => new { wl.Text, wl.FreqRank, wl.CefrLevel })
            .ToListAsync();
        var levelByWord = levels.ToDictionary(
            l => l.Text,
            l => (l.FreqRank, l.CefrLevel),
            StringComparer.OrdinalIgnoreCase);

        var oldKeys = await _context.BookKeyWords.Where(bk => bk.BookId == bookId).ToListAsync();
        _context.BookKeyWords.RemoveRange(oldKeys);

        var bookCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var keyWords = new List<BookKeyWord>();
        var totalWords = 0;

        for (var page = 0; page < pages.Count; page++)
        {
            var tokens = Regex.Matches(pages[page], "[a-zA-Z']+")
                .Select(m => Normalize(m.Value))
                .Where(t => t.Length >= 2)
                .ToList();
            totalWords += tokens.Count;

            var pageFreq = tokens.GroupBy(t => t, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);

            // маркерные: есть в справочнике, чаще всего встречаются на странице
            var pageKeys = pageFreq
                .Where(kv => levelByWord.ContainsKey(kv.Key))
                .OrderByDescending(kv => kv.Value)
                .ThenBy(kv => levelByWord[kv.Key].FreqRank)
                .Take(TopPerPage);

            foreach (var kv in pageKeys)
            {
                var info = levelByWord[kv.Key];
                keyWords.Add(new BookKeyWord
                {
                    BookId = bookId,
                    WordText = kv.Key.ToLowerInvariant(),
                    CefrLevel = info.CefrLevel,
                    FreqRank = info.FreqRank,
                    Page = page + 1,
                    Frequency = kv.Value
                });
            }

            foreach (var kv in pageFreq)
            {
                bookCounts[kv.Key] = bookCounts.GetValueOrDefault(kv.Key) + kv.Value;
            }
        }

        _context.BookKeyWords.AddRange(keyWords);

        book.WordCount = totalWords;
        book.CefrLevel = EstimateLevel(bookCounts, levelByWord);

        await _context.SaveChangesAsync();

        _logger.LogInformation(
            "Analyzer: book {BookId} analyzed — {Words} words, level {Level}, {Keys} key words",
            bookId, totalWords, book.CefrLevel, keyWords.Count);
    }

    // Нормализация токена: отрезаем 's и простые окончания, если базовая форма есть в справочнике
    public static string Normalize(string token)
    {
        var t = token.ToLowerInvariant().Trim('\'');
        return t;
    }

    private static string EstimateLevel(
        Dictionary<string, int> counts,
        Dictionary<string, (int FreqRank, string CefrLevel)> levelByWord)
    {
        var weighted = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        long total = 0;

        foreach (var (word, count) in counts)
        {
            if (!levelByWord.TryGetValue(word, out var info)) continue;
            weighted[info.CefrLevel] = weighted.GetValueOrDefault(info.CefrLevel) + count;
            total += count;
        }

        if (total == 0) return "b1";

        // доля сложных слов (b2+) решает уровень книги
        var hard = weighted.GetValueOrDefault("b2") + weighted.GetValueOrDefault("c1") + weighted.GetValueOrDefault("c2");
        var hardShare = (double)hard / total;

        var mid = weighted.GetValueOrDefault("b1");
        var midShare = (double)mid / total;

        if (hardShare > 0.35) return "c1";
        if (hardShare > 0.18) return "b2";
        if (hardShare > 0.08 || midShare > 0.35) return "b1";
        if (midShare > 0.12) return "a2";
        return "a1";
    }
}
