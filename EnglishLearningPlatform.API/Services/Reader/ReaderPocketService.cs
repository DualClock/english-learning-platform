using System.Text.RegularExpressions;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services.Reader;

/// <summary>
/// «Карман чтения»: слова, которые читатель открыл, но ещё не решил учить.
/// В SRS попадает только после «учить» в разборе главы или в карточке слова.
/// </summary>
public sealed class ReaderPocketService
{
    public const int MaxPocketWordsPerUser = 2000;

    private static readonly Regex AllowedWord = new(
        @"^[a-z][a-z'’\-]*$",
        RegexOptions.Compiled);

    private readonly ApplicationDbContext _context;
    private readonly ReaderContentService _content;
    private readonly DictionaryService _dictionary;
    private readonly LemmatizerService _lemmatizer;
    private readonly ILogger<ReaderPocketService> _logger;

    public ReaderPocketService(
        ApplicationDbContext context,
        ReaderContentService content,
        DictionaryService dictionary,
        LemmatizerService lemmatizer,
        ILogger<ReaderPocketService> logger)
    {
        _context = context;
        _content = content;
        _dictionary = dictionary;
        _lemmatizer = lemmatizer;
        _logger = logger;
    }

    public async Task<ReaderPocketItemDto?> UpsertAsync(
        string userId,
        int bookId,
        UpsertPocketWordRequest request,
        CancellationToken cancellationToken = default)
    {
        var word = NormalizeWord(request.Word);
        if (word.Length < 2)
        {
            return null;
        }

        var source = await _content.GetBookSnapshotAsync(userId, bookId, cancellationToken);
        if (source == null)
        {
            return null;
        }

        var (book, snapshot) = source.Value;
        var chapter = ReaderContentService.FindChapter(snapshot, request.ChapterId);
        if (chapter == null)
        {
            return null;
        }

        var sentence = ReaderContentService.FindSentence(chapter, request.SentenceId);
        if (sentence == null)
        {
            return null;
        }

        var translation = CleanText(request.Translation, 500);
        if (string.IsNullOrWhiteSpace(translation))
        {
            var level = await _context.WordLevels.AsNoTracking()
                .FirstOrDefaultAsync(wl => wl.Text == word, cancellationToken);
            translation = level?.TranslationRu;
        }

        var existing = await _context.ReaderPocketWords
            .FirstOrDefaultAsync(
                p => p.UserId == userId && p.BookId == bookId && p.NormalizedWord == word,
                cancellationToken);

        if (existing == null)
        {
            var count = await _context.ReaderPocketWords
                .CountAsync(p => p.UserId == userId, cancellationToken);
            if (count >= MaxPocketWordsPerUser)
            {
                var excess = count - MaxPocketWordsPerUser + 1;
                var oldest = await _context.ReaderPocketWords
                    .Where(p => p.UserId == userId)
                    .OrderBy(p => p.LastSeenAt)
                    .Take(excess)
                    .ToListAsync(cancellationToken);
                _context.ReaderPocketWords.RemoveRange(oldest);
            }

            existing = new ReaderPocketWord
            {
                UserId = userId,
                BookId = bookId,
                ChapterId = chapter.Id,
                SentenceId = sentence.Id,
                Word = word,
                NormalizedWord = word,
                SentenceText = Truncate(sentence.Text, 500),
                TranslationRu = translation,
                PartOfSpeech = CleanText(request.PartOfSpeech, 50)
            };
            _context.ReaderPocketWords.Add(existing);
        }
        else
        {
            existing.ChapterId = chapter.Id;
            existing.SentenceId = sentence.Id;
            existing.SentenceText = Truncate(sentence.Text, 500);
            existing.LastSeenAt = DateTime.UtcNow;
            if (!string.IsNullOrWhiteSpace(translation))
            {
                existing.TranslationRu = translation;
            }

            var partOfSpeech = CleanText(request.PartOfSpeech, 50);
            if (!string.IsNullOrWhiteSpace(partOfSpeech))
            {
                existing.PartOfSpeech = partOfSpeech;
            }
        }

        try
        {
            await _context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Карточка слова сохраняет слово сразу, а затем обновляет перевод.
            // Два запроса могут прийти одновременно; уникальный индекс оставляет
            // одну строку, второй запрос должен обновить её, а не ответить 500.
            _context.ChangeTracker.Clear();
            var winner = await _context.ReaderPocketWords
                .FirstOrDefaultAsync(
                    p => p.UserId == userId && p.BookId == bookId && p.NormalizedWord == word,
                    cancellationToken);

            if (winner == null)
            {
                throw;
            }

            winner.ChapterId = chapter.Id;
            winner.SentenceId = sentence.Id;
            winner.SentenceText = Truncate(sentence.Text, 500);
            winner.LastSeenAt = DateTime.UtcNow;
            if (!string.IsNullOrWhiteSpace(translation))
            {
                winner.TranslationRu = translation;
            }

            var partOfSpeech = CleanText(request.PartOfSpeech, 50);
            if (!string.IsNullOrWhiteSpace(partOfSpeech))
            {
                winner.PartOfSpeech = partOfSpeech;
            }

            await _context.SaveChangesAsync(cancellationToken);
            existing = winner;
        }

        return ReaderContentService.ToPocketDto(existing);
    }

    public async Task<bool> DeleteAsync(string userId, int pocketId, CancellationToken cancellationToken = default)
    {
        var entry = await _context.ReaderPocketWords
            .FirstOrDefaultAsync(p => p.Id == pocketId && p.UserId == userId, cancellationToken);
        if (entry == null)
        {
            return false;
        }

        _context.ReaderPocketWords.Remove(entry);
        await _context.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<ReaderPocketListResponse?> GetForBookAsync(
        string userId,
        int bookId,
        CancellationToken cancellationToken = default)
    {
        var source = await _content.GetBookSnapshotAsync(userId, bookId, cancellationToken);
        if (source == null)
        {
            return null;
        }

        var items = await _context.ReaderPocketWords.AsNoTracking()
            .Where(p => p.UserId == userId && p.BookId == bookId && p.PromotedAt == null)
            .OrderByDescending(p => p.LastSeenAt)
            .ToListAsync(cancellationToken);

        return new ReaderPocketListResponse
        {
            Items = items.Select(ReaderContentService.ToPocketDto).ToList()
        };
    }

    public async Task<ReaderReviewResponse?> GetReviewAsync(
        string userId,
        int bookId,
        string chapterId,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var source = await _content.GetBookSnapshotAsync(userId, bookId, cancellationToken);
        if (source == null)
        {
            return null;
        }

        var (_, snapshot) = source.Value;
        var chapter = ReaderContentService.FindChapter(snapshot, chapterId);
        if (chapter == null)
        {
            return null;
        }

        var excluded = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var knownTexts = await _context.UserKnownWords.AsNoTracking()
            .Where(k => k.UserId == userId)
            .Select(k => k.Text)
            .ToListAsync(cancellationToken);
        foreach (var text in knownTexts)
        {
            foreach (var form in _lemmatizer.GetForms(text))
            {
                excluded.Add(form);
            }
        }

        var learnedTexts = await _context.UserWords.AsNoTracking()
            .Where(uw => uw.UserId == userId)
            .Select(uw => uw.Word.Text)
            .ToListAsync(cancellationToken);
        foreach (var text in learnedTexts)
        {
            foreach (var form in _lemmatizer.GetForms(text))
            {
                excluded.Add(form);
            }
        }

        var candidates = await _context.ReaderPocketWords.AsNoTracking()
            .Where(p => p.UserId == userId &&
                        p.BookId == bookId &&
                        p.ChapterId == chapterId &&
                        p.PromotedAt == null &&
                        p.KnownAt == null)
            .OrderByDescending(p => p.LastSeenAt)
            .ToListAsync(cancellationToken);

        var items = candidates
            .Where(p => !_lemmatizer.GetForms(p.NormalizedWord).Any(excluded.Contains))
            .Take(Math.Clamp(limit, 1, 10))
            .Select(ReaderContentService.ToPocketDto)
            .ToList();

        return new ReaderReviewResponse { Items = items };
    }

    public async Task<(bool Added, string Word)?> PromoteAsync(
        string userId,
        int pocketId,
        CancellationToken cancellationToken = default)
    {
        var entry = await _context.ReaderPocketWords
            .FirstOrDefaultAsync(p => p.Id == pocketId && p.UserId == userId, cancellationToken);
        if (entry == null)
        {
            return null;
        }

        var definition = string.IsNullOrWhiteSpace(entry.TranslationRu)
            ? "(перевод не сохранён)"
            : entry.TranslationRu;
        var added = await _dictionary.AddWordsAsync(
            userId,
            new[] { (entry.NormalizedWord, definition) },
            source: "reader");

        entry.PromotedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Reader pocket: word {Word} promoted (added={Added})", entry.NormalizedWord, added);
        return (added > 0, entry.Word);
    }

    public async Task<(bool Known, string Word)?> MarkKnownAsync(
        string userId,
        int pocketId,
        CancellationToken cancellationToken = default)
    {
        var entry = await _context.ReaderPocketWords
            .FirstOrDefaultAsync(p => p.Id == pocketId && p.UserId == userId, cancellationToken);
        if (entry == null)
        {
            return null;
        }

        var exists = await _context.UserKnownWords
            .AnyAsync(k => k.UserId == userId && k.Text == entry.NormalizedWord, cancellationToken);
        if (!exists)
        {
            _context.UserKnownWords.Add(new UserKnownWord
            {
                UserId = userId,
                Text = entry.NormalizedWord
            });
        }

        entry.KnownAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);
        ReaderDifficultyService.InvalidateUser(userId);
        return (true, entry.Word);
    }

    public static string NormalizeWord(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        var clean = raw.Trim().ToLowerInvariant()
            .Trim('\'', '"', '.', ',', '!', '?', ';', ':', '(', ')', '[', ']', '«', '»', '“', '”');

        if (clean.EndsWith("'s", StringComparison.Ordinal))
        {
            clean = clean[..^2];
        }

        if (clean.Length < 2 || clean.Length > 100 || !AllowedWord.IsMatch(clean))
        {
            return string.Empty;
        }

        return clean;
    }

    private static string? CleanText(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var clean = Regex.Replace(value, @"\s+", " ").Trim();
        return clean.Length > max ? clean[..max] : clean;
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max];
}
