using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Models.DTOs;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

public class DictionaryService
{
    private readonly ApplicationDbContext _context;

    public DictionaryService(ApplicationDbContext context)
    {
        _context = context;
    }

    public static readonly HashSet<string> AllowedSources = new(StringComparer.OrdinalIgnoreCase)
    {
        "manual", "reader", "key_word", "grammar", "list", "quiz"
    };

    public async Task<WordResponse?> AddWordAsync(string userId, AddWordRequest request, string source = "manual")
    {
        var existingWord = await _context.Words
            .Include(w => w.Definitions)
            .FirstOrDefaultAsync(w => w.Text.ToLower() == request.Text.ToLower());

        Word word;
        
        if (existingWord != null)
        {
            word = existingWord;
        }
        else
        {
            word = new Word
            {
                Text = request.Text,
                Language = "en"
            };

            word.Definitions.Add(new WordDefinition
            {
                Definition = request.Definition,
                PartOfSpeech = request.PartOfSpeech,
                Example = request.Example,
                DisplayOrder = 0
            });

            _context.Words.Add(word);
            await _context.SaveChangesAsync();
        }

        var existingUserWord = await _context.UserWords
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == word.Id);

        if (existingUserWord != null)
        {
            return null;
        }

        var userWord = new UserWord
        {
            UserId = userId,
            WordId = word.Id,
            NextReviewDate = DateTime.UtcNow,
            Source = source
        };

        _context.UserWords.Add(userWord);
        _context.Interactions.Add(new Interaction
        {
            UserId = userId,
            WordId = word.Id,
            Source = source,
            ContextSentence = null
        });
        await _context.SaveChangesAsync();

        return MapToResponse(word);
    }

    public async Task<List<WordResponse>> GetUserWordsAsync(string userId)
    {
        var words = await _context.UserWords
            .Where(uw => uw.UserId == userId)
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .Select(uw => uw.Word)
            .ToListAsync();

        return words.Select(MapToResponse).ToList();
    }

    public async Task<List<WordResponse>> SearchWordsAsync(string userId, string query)
    {
        var words = await _context.UserWords
            .Where(uw => uw.UserId == userId)
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .Where(uw => EF.Functions.ILike(uw.Word.Text, $"%{query}%"))
            .Select(uw => uw.Word)
            .ToListAsync();

        return words.Select(MapToResponse).ToList();
    }

    public async Task<WordResponse?> GetWordAsync(string userId, int wordId)
    {
        var word = await _context.UserWords
            .Where(uw => uw.UserId == userId && uw.WordId == wordId)
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .Select(uw => uw.Word)
            .FirstOrDefaultAsync();

        return word == null ? null : MapToResponse(word);
    }

    public async Task<WordResponse?> UpdateWordAsync(string userId, int wordId, UpdateWordRequest request)
    {
        var userWord = await _context.UserWords
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == wordId);

        if (userWord == null) return null;

        if (!string.IsNullOrEmpty(request.Text))
        {
            userWord.Word.Text = request.Text;
        }

        var definition = userWord.Word.Definitions.FirstOrDefault();
        if (definition != null)
        {
            if (!string.IsNullOrEmpty(request.Definition))
                definition.Definition = request.Definition;
            
            if (request.PartOfSpeech != null)
                definition.PartOfSpeech = request.PartOfSpeech;
            
            if (request.Example != null)
                definition.Example = request.Example;
        }

        await _context.SaveChangesAsync();
        return MapToResponse(userWord.Word);
    }

    public async Task<bool> DeleteWordAsync(string userId, int wordId)
    {
        var userWord = await _context.UserWords
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == wordId);

        if (userWord == null) return false;

        _context.UserWords.Remove(userWord);
        await _context.SaveChangesAsync();
        return true;
    }

    private static WordResponse MapToResponse(Word word)
    {
        return new WordResponse(
            word.Id,
            word.Text,
            word.Language,
            word.Definitions
                .OrderBy(d => d.DisplayOrder)
                .Select(d => new DefinitionResponse(
                    d.Id,
                    d.Definition,
                    d.PartOfSpeech,
                    d.Example
                ))
                .ToList(),
            word.CreatedAt
        );
    }
}