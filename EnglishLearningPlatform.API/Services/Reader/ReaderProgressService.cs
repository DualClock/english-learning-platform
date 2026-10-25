using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services.Reader;

/// <summary>
/// Сохраняет место чтения якорем и обновляет производные поля книги.
/// Клиент не присылает процент: сервер считает его по снимку, чтобы нельзя
/// было «накрутить» прогресс или достижения.
/// </summary>
public sealed class ReaderProgressService
{
    private const int SyntheticPageWords = 300;
    private const int MaxActiveSecondsPerSave = 600;

    private readonly ApplicationDbContext _context;
    private readonly ReaderContentService _content;
    private readonly ActivityService _activity;

    public ReaderProgressService(
        ApplicationDbContext context,
        ReaderContentService content,
        ActivityService activity)
    {
        _context = context;
        _content = content;
        _activity = activity;
    }

    public async Task<ReaderPositionResponse?> UpdateAsync(
        string userId,
        int bookId,
        UpdateReaderPositionRequest request,
        CancellationToken cancellationToken = default)
    {
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

        var charOffset = Math.Clamp(request.CharOffset, 0, Math.Max(0, sentence.Text.Length - 1));
        var ratio = sentence.Text.Length > 0 ? charOffset / (double)sentence.Text.Length : 0;
        var wordsRead = Math.Clamp(
            sentence.WordStart + (int)Math.Round(ratio * sentence.WordCount),
            0,
            snapshot.WordCount);

        var percent = snapshot.WordCount > 0
            ? Math.Round(wordsRead * 100.0 / snapshot.WordCount, 1)
            : 0;

        var progress = await _context.UserBookProgresses
            .FirstOrDefaultAsync(p => p.UserId == userId && p.BookId == bookId, cancellationToken);

        if (progress == null)
        {
            progress = new UserBookProgress
            {
                UserId = userId,
                BookId = bookId
            };
            _context.UserBookProgresses.Add(progress);
        }

        progress.ChapterId = chapter.Id;
        progress.SentenceId = sentence.Id;
        progress.CharOffset = charOffset;
        progress.MaxPercent = Math.Max(progress.MaxPercent, percent);
        progress.PositionUpdatedAt = DateTime.UtcNow;

        // FinishedAt ставит только явное «Дочитано»: процент может дойти до
        // 99,5 на последней странице, но книга закрыта тогда, когда читатель
        // так решил.

        var totalPages = Math.Max(1, (int)Math.Ceiling(snapshot.WordCount / (double)SyntheticPageWords));
        book.TotalPages = totalPages;
        book.CurrentPage = Math.Clamp(
            (int)Math.Ceiling(wordsRead / (double)SyntheticPageWords),
            1,
            totalPages);
        var currentBookProgress = book.Progress < 1 ? book.Progress * 100 : book.Progress;
        book.Progress = Math.Max(currentBookProgress, progress.MaxPercent);
        book.WordCount = snapshot.WordCount;

        var activeSeconds = Math.Clamp(request.ActiveSeconds, 0, MaxActiveSecondsPerSave);
        var minutes = activeSeconds / 60;
        if (minutes > 0)
        {
            // TrackAsync сам сохраняет контекст; прогресс тоже попадёт в БД.
            await _activity.TrackAsync(userId, "read_page", minutes);
        }

        await _context.SaveChangesAsync(cancellationToken);

        return new ReaderPositionResponse
        {
            ChapterId = chapter.Id,
            SentenceId = sentence.Id,
            CharOffset = charOffset,
            MaxPercent = progress.MaxPercent,
            WordsRead = wordsRead,
            Finished = progress.FinishedAt != null
        };
    }

    /// <summary>
    /// «Дочитано» — явное действие в конце последней главы. Процент до этого
    /// момента растёт сам, но книга не считается прочитанной, пока читатель
    /// не закрыл её: иначе 99,5% на предпоследней странице давали бы медаль
    /// за книгу, которую не дочитали.
    /// </summary>
    public async Task<ReaderPositionResponse?> MarkFinishedAsync(
        string userId,
        int bookId,
        string? chapterId,
        CancellationToken cancellationToken = default)
    {
        var source = await _content.GetBookSnapshotAsync(userId, bookId, cancellationToken);
        if (source == null)
        {
            return null;
        }

        var (book, snapshot) = source.Value;
        var chapter = ReaderContentService.FindChapter(snapshot, chapterId);
        if (chapter == null)
        {
            return null;
        }

        // Закрыть книгу можно только на последней главе: иначе «дочитано»
        // превращается в кнопку «пропустить книгу».
        if (snapshot.Chapters.Count == 0 || snapshot.Chapters[^1].Id != chapter.Id)
        {
            return null;
        }

        var progress = await _context.UserBookProgresses
            .FirstOrDefaultAsync(p => p.UserId == userId && p.BookId == bookId, cancellationToken);

        if (progress == null)
        {
            var sentence = chapter.Blocks.SelectMany(b => b.Sentences).LastOrDefault();
            progress = new UserBookProgress
            {
                UserId = userId,
                BookId = bookId,
                ChapterId = chapter.Id,
                SentenceId = sentence?.Id ?? string.Empty
            };
            _context.UserBookProgresses.Add(progress);
        }

        progress.MaxPercent = 100;
        progress.FinishedAt ??= DateTime.UtcNow;
        progress.PositionUpdatedAt = DateTime.UtcNow;

        book.TotalPages = Math.Max(1, (int)Math.Ceiling(snapshot.WordCount / (double)SyntheticPageWords));
        book.CurrentPage = book.TotalPages;
        book.Progress = 100;

        await _context.SaveChangesAsync(cancellationToken);

        return new ReaderPositionResponse
        {
            ChapterId = chapter.Id,
            SentenceId = progress.SentenceId,
            CharOffset = progress.CharOffset,
            MaxPercent = 100,
            WordsRead = snapshot.WordCount,
            Finished = true
        };
    }
}
