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
        "manual", "reader", "key_word", "grammar", "list", "quiz", "category"
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

    // Батчевое добавление слов (FinishSession из читалки): раньше на каждое слово
    // уходило до четырёх обращений к БД — поиск слова, поиск UserWord и два SaveChanges.
    // Теперь три обращения на всю пачку; слова, уже есть у пользователя, пропускаются.
    // Возвращает число реально добавленных слов.
    public async Task<int> AddWordsAsync(
        string userId,
        IEnumerable<(string Text, string Definition)> items,
        string source = "reader")
    {
        var normalized = items
            .Where(i => !string.IsNullOrWhiteSpace(i.Text))
            .Select(i => (Text: i.Text.Trim().ToLower(), Definition: i.Definition))
            .GroupBy(i => i.Text)
            .Select(g => g.First())
            .ToList();

        if (normalized.Count == 0) return 0;

        var texts = normalized.Select(i => i.Text).ToList();

        var existingWords = await _context.Words
            .Include(w => w.Definitions)
            .Where(w => texts.Contains(w.Text.ToLower()))
            .ToListAsync();
        var wordByText = existingWords.ToDictionary(w => w.Text.ToLower(), StringComparer.OrdinalIgnoreCase);

        var ownedWordIds = await _context.UserWords
            .Where(uw => uw.UserId == userId && texts.Contains(uw.Word.Text.ToLower()))
            .Select(uw => uw.WordId)
            .ToListAsync();
        var ownedSet = ownedWordIds.ToHashSet();

        var added = 0;
        foreach (var (text, definition) in normalized)
        {
            if (wordByText.TryGetValue(text, out var word))
            {
                if (ownedSet.Contains(word.Id)) continue;
            }
            else
            {
                word = new Word { Text = text, Language = "en" };
                word.Definitions.Add(new WordDefinition
                {
                    Definition = definition,
                    DisplayOrder = 0
                });
                _context.Words.Add(word);
            }

            _context.UserWords.Add(new UserWord
            {
                UserId = userId,
                Word = word,
                NextReviewDate = DateTime.UtcNow,
                Source = source
            });
            _context.Interactions.Add(new Interaction
            {
                UserId = userId,
                Word = word,
                Source = source
            });
            added++;
        }

        if (added > 0) await _context.SaveChangesAsync();
        return added;
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