using System.Collections.Concurrent;
using EnglishLearningPlatform.API.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services;

public record PageDifficulty(
    int Page,
    int TotalWords,
    int KnownWords,
    int LearningWords,
    int NewWords,
    double KnownPercent,
    double LearningPercent,
    double NewPercent);

public record BookDifficulty(
    List<PageDifficulty> Pages,
    PageDifficulty Average,
    int TotalWords,
    int KnownWordCount,
    int LearningWordCount);

/// <summary>
/// Считает «сложность» книги для конкретного пользователя: долю знакомых,
/// изучаемых и новых слов по каждой странице. Знакомые — явно отмеченные
/// (UserKnownWord) и зрелые карточки SRS; изучаемые — остальные слова из
/// словаря; всё прочее — новое.
/// </summary>
public class ReaderDifficultyService
{
    // Карточка с интервалом ≥ 21 дня считается освоенной (как в Anki: mature)
    private const int MatureIntervalDays = 21;

    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);

    // Версия на пользователя: отметил слово известным — кэш пересчитается
    private static readonly ConcurrentDictionary<string, int> UserVersions = new();

    private readonly ApplicationDbContext _context;
    private readonly BookService _bookService;
    private readonly LemmatizerService _lemmatizer;
    private readonly IMemoryCache _cache;

    public ReaderDifficultyService(
        ApplicationDbContext context,
        BookService bookService,
        LemmatizerService lemmatizer,
        IMemoryCache cache)
    {
        _context = context;
        _bookService = bookService;
        _lemmatizer = lemmatizer;
        _cache = cache;
    }

    public static void InvalidateUser(string userId)
    {
        UserVersions.AddOrUpdate(userId, 1, (_, current) => current + 1);
    }

    public async Task<BookDifficulty?> GetAsync(string userId, int bookId, int pageSize = 300)
    {
        var version = UserVersions.GetValueOrDefault(userId, 0);
        var cacheKey = $"bookdifficulty:{userId}:{bookId}:{pageSize}:{version}";

        if (_cache.TryGetValue(cacheKey, out BookDifficulty? cached) && cached != null)
        {
            return cached;
        }

        var pages = await _bookService.GetPagesAsync(bookId, pageSize);
        if (pages == null)
        {
            return null;
        }

        var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var learning = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var knownWords = await _context.UserKnownWords.AsNoTracking()
            .Where(k => k.UserId == userId)
            .Select(k => k.Text)
            .ToListAsync();

        foreach (var word in knownWords)
        {
            AddWithForms(known, word);
        }

        var userWords = await _context.UserWords.AsNoTracking()
            .Where(uw => uw.UserId == userId)
            .Select(uw => new { uw.Word.Text, uw.Interval })
            .ToListAsync();

        foreach (var entry in userWords)
        {
            if (entry.Interval >= MatureIntervalDays)
            {
                AddWithForms(known, entry.Text);
            }
            else
            {
                AddWithForms(learning, entry.Text);
            }
        }

        var pageStats = new List<PageDifficulty>(pages.Count);
        var totalWords = 0;
        var totalKnown = 0;
        var totalLearning = 0;
        var totalNew = 0;

        for (var index = 0; index < pages.Count; index++)
        {
            var pageKnown = 0;
            var pageLearning = 0;
            var pageNew = 0;
            var pageTotal = 0;

            foreach (var token in _lemmatizer.Tokenize(pages[index]))
            {
                pageTotal++;
                var forms = _lemmatizer.GetForms(token);

                if (forms.Any(known.Contains))
                {
                    pageKnown++;
                }
                else if (forms.Any(learning.Contains))
                {
                    pageLearning++;
                }
                else
                {
                    pageNew++;
                }
            }

            totalWords += pageTotal;
            totalKnown += pageKnown;
            totalLearning += pageLearning;
            totalNew += pageNew;

            pageStats.Add(new PageDifficulty(
                index + 1,
                pageTotal,
                pageKnown,
                pageLearning,
                pageNew,
                Percent(pageKnown, pageTotal),
                Percent(pageLearning, pageTotal),
                Percent(pageNew, pageTotal)));
        }

        var average = new PageDifficulty(
            0,
            totalWords,
            totalKnown,
            totalLearning,
            totalNew,
            Percent(totalKnown, totalWords),
            Percent(totalLearning, totalWords),
            Percent(totalNew, totalWords));

        var result = new BookDifficulty(pageStats, average, totalWords, known.Count, learning.Count);

        _cache.Set(cacheKey, result, CacheTtl);
        return result;
    }

    private void AddWithForms(HashSet<string> target, string word)
    {
        foreach (var form in _lemmatizer.GetForms(word))
        {
            target.Add(form);
        }

        var raw = (word ?? string.Empty).Trim();
        if (raw.Length > 0)
        {
            target.Add(raw);
        }
    }

    private static double Percent(int part, int total) =>
        total == 0 ? 0 : Math.Round(part * 100.0 / total, 1);
}
