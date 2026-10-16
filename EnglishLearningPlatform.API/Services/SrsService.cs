using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

public class SrsService
{
    private readonly ApplicationDbContext _context;

    public SrsService(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<UserWord?> ReviewWordAsync(string userId, int wordId, int quality)
    {
        if (quality < 1 || quality > 5)
            return null;

        var userWord = await _context.UserWords
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == wordId);

        if (userWord == null) return null;

        var (interval, easeFactor, repetitions) = CalculateNextReview(
            quality,
            userWord.Interval,
            userWord.EaseFactor,
            userWord.RepetitionCount
        );

        userWord.Interval = interval;
        userWord.EaseFactor = easeFactor;
        userWord.RepetitionCount = repetitions;
        userWord.NextReviewDate = DateTime.UtcNow.AddDays(interval);
        userWord.LastReviewedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();
        return userWord;
    }

    public async Task<List<UserWord>> GetWordsForReviewAsync(string userId, int limit = 20)
    {
        return await _context.UserWords
            .Where(uw => uw.UserId == userId && 
                        (uw.NextReviewDate == null || uw.NextReviewDate <= DateTime.UtcNow))
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .OrderBy(uw => uw.NextReviewDate)
            .Take(limit)
            .ToListAsync();
    }

    public async Task<int> GetReviewCountAsync(string userId)
    {
        return await _context.UserWords
            .CountAsync(uw => uw.UserId == userId && 
                            (uw.NextReviewDate == null || uw.NextReviewDate <= DateTime.UtcNow));
    }

    public static (int interval, double easeFactor, int repetitions) CalculateNextReview(
        int quality, int currentInterval, double currentEaseFactor, int currentRepetitions)
    {
        int interval;
        int repetitions;
        double easeFactor = currentEaseFactor;

        if (quality < 3)
        {
            interval = 1;
            repetitions = 0;
        }
        else
        {
            repetitions = currentRepetitions + 1;

            if (repetitions == 1)
            {
                interval = 1;
            }
            else if (repetitions == 2)
            {
                interval = 6;
            }
            else
            {
                interval = (int)Math.Round(currentInterval * easeFactor);
            }

            easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
            
            if (easeFactor < 1.3)
                easeFactor = 1.3;
        }

        return (interval, easeFactor, repetitions);
    }
}