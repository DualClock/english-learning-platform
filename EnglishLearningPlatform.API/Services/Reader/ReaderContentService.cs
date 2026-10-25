using System.Collections.Concurrent;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Services.Reader;

/// <summary>
/// Снимки книг, манифест и главы. GET здесь ничего не двигает в прогрессе:
/// единственная запись — первичный разбор EPUB, который переиспользуется
/// всеми копиями книги.
/// </summary>
public sealed class ReaderContentService
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> ParseLocks = new();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private static readonly TimeSpan SnapshotCacheTtl = TimeSpan.FromHours(1);
    private static readonly TimeSpan AssetUrlTtl = TimeSpan.FromDays(7);

    private readonly ApplicationDbContext _context;
    private readonly BookService _bookService;
    private readonly BookSnapshotParser _parser;
    private readonly ReaderAssetService _assets;
    private readonly LemmatizerService _lemmatizer;
    private readonly IMemoryCache _cache;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<ReaderContentService> _logger;

    public ReaderContentService(
        ApplicationDbContext context,
        BookService bookService,
        BookSnapshotParser parser,
        ReaderAssetService assets,
        LemmatizerService lemmatizer,
        IMemoryCache cache,
        IWebHostEnvironment environment,
        ILogger<ReaderContentService> logger)
    {
        _context = context;
        _bookService = bookService;
        _parser = parser;
        _assets = assets;
        _lemmatizer = lemmatizer;
        _cache = cache;
        _environment = environment;
        _logger = logger;
    }

    public async Task<ReaderSnapshot?> EnsureSnapshotAsync(Book book, CancellationToken cancellationToken = default)
    {
        if (book.ContentSnapshotId is int linkedId)
        {
            var linked = await LoadSnapshotAsync(linkedId, cancellationToken);
            if (linked != null && linked.ParserVersion == BookSnapshotParser.ParserVersion)
            {
                return linked;
            }
        }

        var filePath = GetBookFilePath(book);
        if (!File.Exists(filePath))
        {
            _logger.LogWarning("Reader: EPUB file missing for book {BookId}", book.Id);
            return null;
        }

        var hash = book.ContentHash;
        if (string.IsNullOrWhiteSpace(hash))
        {
            hash = await ComputeHashAsync(filePath, cancellationToken);
            book.ContentHash = hash;
        }

        var existing = await _context.BookContentSnapshots.AsNoTracking()
            .FirstOrDefaultAsync(
                s => s.ContentHash == hash && s.ParserVersion == BookSnapshotParser.ParserVersion,
                cancellationToken);

        if (existing != null)
        {
            await LinkBookAsync(book, existing, cancellationToken);
            return await LoadSnapshotAsync(existing.Id, cancellationToken);
        }

        var gate = ParseLocks.GetOrAdd($"{hash}:{BookSnapshotParser.ParserVersion}", _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);

        try
        {
            existing = await _context.BookContentSnapshots.AsNoTracking()
                .FirstOrDefaultAsync(
                    s => s.ContentHash == hash && s.ParserVersion == BookSnapshotParser.ParserVersion,
                    cancellationToken);

            if (existing != null)
            {
                await LinkBookAsync(book, existing, cancellationToken);
                return await LoadSnapshotAsync(existing.Id, cancellationToken);
            }

            var snapshot = await _parser.ParseAsync(filePath, hash, cancellationToken);
            var json = JsonSerializer.SerializeToUtf8Bytes(snapshot, JsonOptions);
            var gzip = Compress(json);

            var entity = new BookContentSnapshot
            {
                ContentHash = hash,
                ParserVersion = BookSnapshotParser.ParserVersion,
                JsonGzip = gzip,
                ChapterCount = snapshot.Chapters.Count,
                WordCount = snapshot.WordCount
            };

            _context.BookContentSnapshots.Add(entity);
            try
            {
                await _context.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException)
            {
                // Параллельный запрос успел первым: уникальный индекс — источник истины.
                _context.Entry(entity).State = EntityState.Detached;
                existing = await _context.BookContentSnapshots.AsNoTracking()
                    .FirstAsync(
                        s => s.ContentHash == hash && s.ParserVersion == BookSnapshotParser.ParserVersion,
                        cancellationToken);
                await LinkBookAsync(book, existing, cancellationToken);
                return await LoadSnapshotAsync(existing.Id, cancellationToken);
            }

            await LinkBookAsync(book, entity, cancellationToken);
            _cache.Set(CacheKey(entity.Id), snapshot, SnapshotCacheTtl);
            return snapshot;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<ReaderSnapshot?> EnsureSnapshotAsync(int bookId, CancellationToken cancellationToken = default)
    {
        var book = await _context.Books.FirstOrDefaultAsync(b => b.Id == bookId, cancellationToken);
        return book == null ? null : await EnsureSnapshotAsync(book, cancellationToken);
    }

    public async Task<(Book Book, ReaderSnapshot Snapshot)?> GetBookSnapshotAsync(
        string userId,
        int bookId,
        CancellationToken cancellationToken = default)
    {
        var book = await _bookService.GetBookAsync(userId, bookId);
        if (book == null)
        {
            return null;
        }

        var snapshot = await EnsureSnapshotAsync(book, cancellationToken);
        return snapshot == null ? null : (book, snapshot);
    }

    public async Task<ReaderManifestResponse?> GetManifestAsync(
        string userId,
        int bookId,
        CancellationToken cancellationToken = default)
    {
        var source = await GetBookSnapshotAsync(userId, bookId, cancellationToken);
        if (source == null)
        {
            return null;
        }

        var (book, snapshot) = source.Value;
        var progress = await _context.UserBookProgresses.AsNoTracking()
            .FirstOrDefaultAsync(p => p.UserId == userId && p.BookId == bookId, cancellationToken);

        var pocketCount = await _context.ReaderPocketWords.AsNoTracking()
            .CountAsync(p => p.UserId == userId && p.BookId == bookId && p.PromotedAt == null, cancellationToken);

        var bookmarks = await _context.BookBookmarks.AsNoTracking()
            .Where(b => b.BookId == bookId && b.UserId == userId)
            .OrderBy(b => b.CreatedAt)
            .ToListAsync(cancellationToken);

        var position = BuildPosition(snapshot, progress, book);

        return new ReaderManifestResponse
        {
            Book = new ReaderBookDto
            {
                Id = book.Id,
                Title = book.Title,
                Author = book.Author,
                Language = book.Language,
                CoverUrl = book.CoverUrl,
                WordCount = snapshot.WordCount
            },
            Manifest = snapshot.Chapters.Select(c => new ReaderManifestChapterDto
            {
                Id = c.Id,
                Title = c.Title,
                Level = c.Level,
                WordStart = c.WordStart,
                WordCount = c.WordCount
            }).ToList(),
            Position = position,
            PocketCount = pocketCount,
            Bookmarks = bookmarks.Select(b => ToBookmarkDto(b, snapshot)).ToList()
        };
    }

    public async Task<ReaderChapterDto?> GetChapterAsync(
        string userId,
        int bookId,
        string chapterId,
        CancellationToken cancellationToken = default)
    {
        var source = await GetBookSnapshotAsync(userId, bookId, cancellationToken);
        if (source == null)
        {
            return null;
        }

        var (book, snapshot) = source.Value;
        var chapter = FindChapter(snapshot, chapterId);
        if (chapter == null)
        {
            return null;
        }

        var knownForms = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var learningForms = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var knownTexts = await _context.UserKnownWords.AsNoTracking()
            .Where(k => k.UserId == userId)
            .Select(k => k.Text)
            .ToListAsync(cancellationToken);
        foreach (var text in knownTexts)
        {
            foreach (var form in _lemmatizer.GetForms(text))
            {
                knownForms.Add(form);
            }
        }

        var userWords = await _context.UserWords.AsNoTracking()
            .Where(uw => uw.UserId == userId)
            .Select(uw => new { uw.Word.Text, uw.Interval })
            .ToListAsync(cancellationToken);
        foreach (var entry in userWords)
        {
            var target = entry.Interval >= 21 ? knownForms : learningForms;
            foreach (var form in _lemmatizer.GetForms(entry.Text))
            {
                target.Add(form);
            }
        }

        var pocket = await _context.ReaderPocketWords.AsNoTracking()
            .Where(p => p.UserId == userId && p.BookId == bookId && p.ChapterId == chapterId && p.PromotedAt == null)
            .OrderByDescending(p => p.LastSeenAt)
            .ToListAsync(cancellationToken);

        var knownWords = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var learningWords = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var totalWords = 0;
        var knownCount = 0;
        var learningCount = 0;
        var newCount = 0;

        foreach (var sentence in chapter.Blocks.SelectMany(b => b.Sentences))
        {
            foreach (var token in _lemmatizer.Tokenize(sentence.Text))
            {
                totalWords++;
                var forms = _lemmatizer.GetForms(token);
                if (forms.Any(knownForms.Contains))
                {
                    knownCount++;
                    knownWords.Add(token);
                }
                else if (forms.Any(learningForms.Contains))
                {
                    learningCount++;
                    learningWords.Add(token);
                }
                else
                {
                    newCount++;
                }
            }
        }

        var now = DateTime.UtcNow;
        var chapterIndex = snapshot.Chapters.FindIndex(c => c.Id == chapter.Id);

        return new ReaderChapterDto
        {
            Id = chapter.Id,
            Title = chapter.Title,
            Level = chapter.Level,
            Index = chapterIndex,
            TotalChapters = snapshot.Chapters.Count,
            WordStart = chapter.WordStart,
            WordCount = chapter.WordCount,
            Blocks = chapter.Blocks.Select(block => new ReaderBlockDto
            {
                Id = block.Id,
                Type = block.Type,
                Sentences = block.Sentences.Select(s => new ReaderSentenceDto
                {
                    Id = s.Id,
                    Text = s.Text,
                    WordStart = s.WordStart,
                    WordCount = s.WordCount
                }).ToList(),
                Asset = block.Asset,
                AssetUrl = string.IsNullOrWhiteSpace(block.Asset) || string.IsNullOrWhiteSpace(book.ContentHash)
                    ? null
                    : _assets.BuildUrl(book.ContentHash, block.Asset, now, AssetUrlTtl),
                Alt = block.Alt,
                Caption = block.Caption,
                Width = block.Width,
                Height = block.Height
            }).ToList(),
            WordStatus = new ReaderWordStatusDto
            {
                Known = knownWords.OrderBy(w => w).ToList(),
                Learning = learningWords.OrderBy(w => w).ToList(),
                Pocket = pocket.Select(ToPocketDto).ToList()
            },
            Difficulty = new ReaderChapterDifficultyDto
            {
                TotalWords = totalWords,
                KnownWords = knownCount,
                LearningWords = learningCount,
                NewWords = newCount,
                KnownPercent = totalWords > 0 ? Math.Round(knownCount * 100.0 / totalWords, 1) : 0
            }
        };
    }

    public static ReaderChapter? FindChapter(ReaderSnapshot snapshot, string? chapterId) =>
        string.IsNullOrWhiteSpace(chapterId)
            ? snapshot.Chapters.FirstOrDefault()
            : snapshot.Chapters.FirstOrDefault(c => c.Id == chapterId);

    public static ReaderSentence? FindSentence(ReaderChapter chapter, string? sentenceId) =>
        string.IsNullOrWhiteSpace(sentenceId)
            ? chapter.Blocks.SelectMany(b => b.Sentences).FirstOrDefault()
            : chapter.Blocks.SelectMany(b => b.Sentences).FirstOrDefault(s => s.Id == sentenceId);

    public static ReaderPositionDto BuildPosition(
        ReaderSnapshot snapshot,
        UserBookProgress? progress,
        Book book)
    {
        if (progress != null)
        {
            var chapter = FindChapter(snapshot, progress.ChapterId);
            var sentence = chapter == null ? null : FindSentence(chapter, progress.SentenceId);
            if (chapter != null && sentence != null)
            {
                return new ReaderPositionDto
                {
                    ChapterId = chapter.Id,
                    SentenceId = sentence.Id,
                    CharOffset = Math.Clamp(progress.CharOffset, 0, Math.Max(0, sentence.Text.Length - 1)),
                    MaxPercent = Math.Clamp(progress.MaxPercent, 0, 100),
                    FinishedAt = progress.FinishedAt
                };
            }
        }

        var legacyWords = Math.Max(0, (book.CurrentPage - 1) * 300);
        var mapped = MapWordOffset(snapshot, legacyWords);
        return new ReaderPositionDto
        {
            ChapterId = mapped.Chapter.Id,
            SentenceId = mapped.Sentence.Id,
            CharOffset = mapped.CharOffset,
            MaxPercent = Math.Clamp(book.Progress, 0, 100)
        };
    }

    public static (ReaderChapter Chapter, ReaderSentence Sentence, int CharOffset, int WordsBefore) MapWordOffset(
        ReaderSnapshot snapshot,
        int wordsBefore)
    {
        var total = Math.Max(0, snapshot.WordCount - 1);
        var clamped = Math.Clamp(wordsBefore, 0, total);

        var chapter = snapshot.Chapters.FirstOrDefault() ?? throw new InvalidOperationException("Пустая книга.");
        foreach (var candidate in snapshot.Chapters)
        {
            if (candidate.WordStart <= clamped)
            {
                chapter = candidate;
            }
            else
            {
                break;
            }
        }

        var sentences = chapter.Blocks.SelectMany(b => b.Sentences).ToList();
        var sentence = sentences.FirstOrDefault();
        if (sentence == null)
        {
            throw new InvalidOperationException("В главе нет предложений.");
        }

        foreach (var candidate in sentences)
        {
            if (candidate.WordStart <= clamped)
            {
                sentence = candidate;
            }
            else
            {
                break;
            }
        }

        var ratio = sentence.WordCount > 0
            ? (clamped - sentence.WordStart) / (double)sentence.WordCount
            : 0;
        var charOffset = Math.Clamp(
            (int)Math.Floor(ratio * sentence.Text.Length),
            0,
            Math.Max(0, sentence.Text.Length - 1));

        return (chapter, sentence, charOffset, clamped);
    }

    public static ReaderBookmarkDto ToBookmarkDto(BookBookmark bookmark, ReaderSnapshot snapshot)
    {
        var chapterId = bookmark.ChapterId;
        var sentenceId = bookmark.SentenceId;
        var charOffset = bookmark.CharOffset;
        var excerpt = bookmark.Excerpt;

        if (string.IsNullOrWhiteSpace(chapterId) && bookmark.Page is > 1)
        {
            var mapped = MapWordOffset(snapshot, (bookmark.Page.Value - 1) * 300);
            chapterId = mapped.Chapter.Id;
            sentenceId = mapped.Sentence.Id;
            charOffset = mapped.CharOffset;
            excerpt ??= mapped.Sentence.Text;
        }

        return new ReaderBookmarkDto
        {
            Id = bookmark.Id,
            Page = bookmark.Page,
            ChapterId = chapterId,
            SentenceId = sentenceId,
            CharOffset = charOffset,
            Excerpt = excerpt,
            Note = bookmark.Note,
            CreatedAt = bookmark.CreatedAt
        };
    }

    public static ReaderPocketItemDto ToPocketDto(ReaderPocketWord word) => new()
    {
        Id = word.Id,
        Word = word.Word,
        TranslationRu = word.TranslationRu,
        PartOfSpeech = word.PartOfSpeech,
        SentenceId = word.SentenceId,
        SentenceText = word.SentenceText,
        ChapterId = word.ChapterId,
        CreatedAt = word.CreatedAt
    };

    private async Task LinkBookAsync(Book book, BookContentSnapshot snapshot, CancellationToken cancellationToken)
    {
        if (book.ContentSnapshotId == snapshot.Id &&
            book.ContentHash == snapshot.ContentHash &&
            book.WordCount == snapshot.WordCount)
        {
            return;
        }

        book.ContentSnapshotId = snapshot.Id;
        book.ContentHash = snapshot.ContentHash;
        book.WordCount = snapshot.WordCount;
        book.ParsedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);
    }

    private async Task<ReaderSnapshot?> LoadSnapshotAsync(int snapshotId, CancellationToken cancellationToken)
    {
        var key = CacheKey(snapshotId);
        if (_cache.TryGetValue(key, out ReaderSnapshot? cached) && cached != null)
        {
            return cached;
        }

        var bytes = await _context.BookContentSnapshots.AsNoTracking()
            .Where(s => s.Id == snapshotId)
            .Select(s => s.JsonGzip)
            .FirstOrDefaultAsync(cancellationToken);
        if (bytes == null || bytes.Length == 0)
        {
            return null;
        }

        try
        {
            using var input = new MemoryStream(bytes);
            using var gzip = new GZipStream(input, CompressionMode.Decompress);
            var snapshot = await JsonSerializer.DeserializeAsync<ReaderSnapshot>(gzip, JsonOptions, cancellationToken);
            if (snapshot != null)
            {
                _cache.Set(key, snapshot, SnapshotCacheTtl);
            }

            return snapshot;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Reader: failed to decompress snapshot {SnapshotId}", snapshotId);
            return null;
        }
    }

    private string GetBookFilePath(Book book) =>
        Path.Combine(_environment.ContentRootPath, "uploads", "books", book.FilePath);

    private static async Task<string> ComputeHashAsync(string filePath, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(filePath);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static byte[] Compress(byte[] json)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true))
        {
            gzip.Write(json);
        }

        return output.ToArray();
    }

    private static string CacheKey(int snapshotId) => $"reader:snapshot:{snapshotId}";
}
