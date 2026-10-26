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
        "manual", "reader", "key_word", "grammar", "list", "quiz", "category", "bulk"
    };

    public async Task<WordResponse?> AddWordAsync(string userId, AddWordRequest request, string source = "manual")
    {
        var existingWord = await _context.Words
            .Include(w => w.Definitions)
            .FirstOrDefaultAsync(w => w.Text.ToLower() == request.Text.ToLower());

        var definition = request.Definition?.Trim();
        var example = request.Example?.Trim();
        var context = request.Context?.Trim();
        var interactionContext = string.IsNullOrWhiteSpace(context) ? example : context;

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

            // Пустой WordDefinition — это не «слово без перевода», а битая
            // карточка в повторениях и тестах. Просто не создаём строку.
            if (!string.IsNullOrWhiteSpace(definition))
            {
                word.Definitions.Add(new WordDefinition
                {
                    Definition = definition,
                    PartOfSpeech = request.PartOfSpeech,
                    Example = example,
                    DisplayOrder = 0
                });
            }

            _context.Words.Add(word);
            await _context.SaveChangesAsync();
        }

        var existingUserWord = await _context.UserWords
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == word.Id);

        if (existingUserWord != null)
        {
            return null;
        }

        // Слово уже было в общей базе без перевода (например, из чужой
        // пачки или из слуха). Первый, кто знает перевод, заполняет его.
        if (existingWord != null
            && existingWord.Definitions.Count == 0
            && !string.IsNullOrWhiteSpace(definition))
        {
            existingWord.Definitions.Add(new WordDefinition
            {
                Definition = definition,
                PartOfSpeech = request.PartOfSpeech,
                Example = example,
                DisplayOrder = 0
            });
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
            ContextSentence = interactionContext
        });
        await _context.SaveChangesAsync();

        return MapToResponse(word, source, interactionContext);
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
                if (!string.IsNullOrWhiteSpace(definition))
                {
                    word.Definitions.Add(new WordDefinition
                    {
                        Definition = definition.Trim(),
                        DisplayOrder = 0
                    });
                }
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

    public async Task<(List<WordResponse> Items, int TotalCount)> GetUserWordsAsync(string userId, int page, int pageSize)
    {
        var query = _context.UserWords
            .Where(uw => uw.UserId == userId)
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions);

        var totalCount = await query.CountAsync();

        var userWords = await query
            .OrderByDescending(uw => uw.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var contexts = await LoadContextsAsync(
            userId,
            userWords.Select(uw => uw.WordId));
        var categoryIcons = await LoadCategoryIconsAsync(
            userWords.Select(uw => uw.Word.Text));
        var examples = await LoadWordExamplesAsync(
            userWords.Select(uw => uw.Word.Text));

        var items = userWords
            .Select(uw =>
            {
                var example = examples.GetValueOrDefault(uw.Word.Text);
                return MapToResponse(
                    uw.Word,
                    uw.Source,
                    contexts.GetValueOrDefault(uw.WordId),
                    uw.Emoji,
                    uw.ImageUrl,
                    categoryIcons.GetValueOrDefault(uw.Word.Text),
                    example.Example,
                    example.ExampleRu);
            })
            .ToList();

        return (items, totalCount);
    }

    public async Task<List<WordResponse>> SearchWordsAsync(string userId, string query)
    {
        // Ограничиваем длину поискового запроса и число результатов:
        // поиск — дорогая ILIKE-операция, нельзя отдавать тонну строк
        var trimmed = query.Trim().Length > 100 ? query.Trim()[..100] : query.Trim();

        var userWords = await _context.UserWords
            .Where(uw => uw.UserId == userId)
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .Where(uw => EF.Functions.ILike(uw.Word.Text, $"%{trimmed}%"))
            .OrderBy(uw => uw.Word.Text)
            .Take(50)
            .ToListAsync();

        var contexts = await LoadContextsAsync(
            userId,
            userWords.Select(uw => uw.WordId));
        var categoryIcons = await LoadCategoryIconsAsync(
            userWords.Select(uw => uw.Word.Text));
        var examples = await LoadWordExamplesAsync(
            userWords.Select(uw => uw.Word.Text));

        return userWords
            .Select(uw =>
            {
                var example = examples.GetValueOrDefault(uw.Word.Text);
                return MapToResponse(
                    uw.Word,
                    uw.Source,
                    contexts.GetValueOrDefault(uw.WordId),
                    uw.Emoji,
                    uw.ImageUrl,
                    categoryIcons.GetValueOrDefault(uw.Word.Text),
                    example.Example,
                    example.ExampleRu);
            })
            .ToList();
    }

    public async Task<WordResponse?> GetWordAsync(string userId, int wordId)
    {
        var userWord = await _context.UserWords
            .Where(uw => uw.UserId == userId && uw.WordId == wordId)
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .FirstOrDefaultAsync();

        if (userWord == null) return null;

        var contexts = await LoadContextsAsync(userId, new[] { wordId });
        var categoryIcons = await LoadCategoryIconsAsync(new[] { userWord.Word.Text });
        var examples = await LoadWordExamplesAsync(new[] { userWord.Word.Text });
        var reference = examples.GetValueOrDefault(userWord.Word.Text);
        return MapToResponse(
            userWord.Word,
            userWord.Source,
            contexts.GetValueOrDefault(wordId),
            userWord.Emoji,
            userWord.ImageUrl,
            categoryIcons.GetValueOrDefault(userWord.Word.Text),
            reference.Example,
            reference.ExampleRu);
    }

    public async Task<WordResponse?> UpdateWordAsync(string userId, int wordId, UpdateWordRequest request)
    {
        var userWord = await _context.UserWords
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == wordId);

        if (userWord == null) return null;

        var word = userWord.Word;
        var requestedDefinition = request.Definition?.Trim();

        // Слово может быть общим для нескольких пользователей (Words — глобальная
        // таблица). Правка такого слова «на месте» меняла бы перевод всем.
        // Для общих слов делаем личную копию и переключаем на неё только свой UserWord.
        var sharedWithOthers = await _context.UserWords
            .AnyAsync(uw => uw.WordId == word.Id && uw.UserId != userId);

        if (sharedWithOthers)
        {
            var source = word.Definitions.OrderBy(d => d.DisplayOrder).FirstOrDefault();
            var copy = new Word
            {
                Text = string.IsNullOrEmpty(request.Text) ? word.Text : request.Text,
                Language = word.Language
            };

            var copyDefinition = string.IsNullOrWhiteSpace(requestedDefinition)
                ? source?.Definition
                : requestedDefinition;

            if (!string.IsNullOrWhiteSpace(copyDefinition))
            {
                copy.Definitions.Add(new WordDefinition
                {
                    Definition = copyDefinition,
                    PartOfSpeech = request.PartOfSpeech ?? source?.PartOfSpeech,
                    Example = request.Example ?? source?.Example,
                    DisplayOrder = 0
                });
            }

            _context.Words.Add(copy);
            await _context.SaveChangesAsync();

            // Контекст и история встреч принадлежат пользователю: после копии
            // переносим их на новое слово, иначе карточка потеряет предложение.
            var interactions = await _context.Interactions
                .Where(i => i.UserId == userId && i.WordId == word.Id)
                .ToListAsync();
            foreach (var interaction in interactions)
            {
                interaction.WordId = copy.Id;
            }

            userWord.WordId = copy.Id;
            userWord.Word = copy;
            await _context.SaveChangesAsync();

            var copyContexts = await LoadContextsAsync(userId, new[] { copy.Id });
            var copyIcons = await LoadCategoryIconsAsync(new[] { copy.Text });
            var copyExamples = await LoadWordExamplesAsync(new[] { copy.Text });
            var copyReference = copyExamples.GetValueOrDefault(copy.Text);
            return MapToResponse(
                copy,
                userWord.Source,
                copyContexts.GetValueOrDefault(copy.Id),
                userWord.Emoji,
                userWord.ImageUrl,
                copyIcons.GetValueOrDefault(copy.Text),
                copyReference.Example,
                copyReference.ExampleRu);
        }

        if (!string.IsNullOrEmpty(request.Text))
        {
            word.Text = request.Text;
        }

        var definition = word.Definitions.FirstOrDefault();
        if (definition == null && !string.IsNullOrWhiteSpace(requestedDefinition))
        {
            // Слово сохранили без перевода — при первом редактировании
            // создаём определение, а не пытаемся обновить несуществующее.
            definition = new WordDefinition { DisplayOrder = 0 };
            word.Definitions.Add(definition);
        }

        if (definition != null)
        {
            if (!string.IsNullOrWhiteSpace(requestedDefinition))
                definition.Definition = requestedDefinition;
            
            if (request.PartOfSpeech != null)
                definition.PartOfSpeech = request.PartOfSpeech;
            
            if (request.Example != null)
                definition.Example = request.Example;
        }

        await _context.SaveChangesAsync();
        var contexts = await LoadContextsAsync(userId, new[] { word.Id });
        var categoryIcons = await LoadCategoryIconsAsync(new[] { word.Text });
        var examples = await LoadWordExamplesAsync(new[] { word.Text });
        var reference = examples.GetValueOrDefault(word.Text);
        return MapToResponse(
            word,
            userWord.Source,
            contexts.GetValueOrDefault(word.Id),
            userWord.Emoji,
            userWord.ImageUrl,
            categoryIcons.GetValueOrDefault(word.Text),
            reference.Example,
            reference.ExampleRu);
    }

    public async Task<(WordResponse? Word, string? RemovedImageUrl)> SetEmojiAsync(
        string userId,
        int wordId,
        string? emoji)
    {
        var userWord = await _context.UserWords
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == wordId);

        if (userWord == null) return (null, null);

        var normalized = emoji?.Trim();
        var removedImage = string.IsNullOrEmpty(normalized) ? null : userWord.ImageUrl;

        userWord.Emoji = string.IsNullOrEmpty(normalized) ? null : normalized;
        if (!string.IsNullOrEmpty(normalized))
        {
            userWord.ImageUrl = null;
        }

        await _context.SaveChangesAsync();

        var contexts = await LoadContextsAsync(userId, new[] { wordId });
        var response = MapToResponse(
            userWord.Word,
            userWord.Source,
            contexts.GetValueOrDefault(wordId),
            userWord.Emoji,
            userWord.ImageUrl);

        return (response, removedImage);
    }

    public async Task<(WordResponse? Word, string? RemovedImageUrl)> SetImageAsync(
        string userId,
        int wordId,
        string imageUrl)
    {
        var userWord = await _context.UserWords
            .Include(uw => uw.Word)
                .ThenInclude(w => w.Definitions)
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == wordId);

        if (userWord == null) return (null, null);

        var removedImage = userWord.ImageUrl;
        userWord.ImageUrl = imageUrl;
        userWord.Emoji = null;

        await _context.SaveChangesAsync();

        var contexts = await LoadContextsAsync(userId, new[] { wordId });
        var response = MapToResponse(
            userWord.Word,
            userWord.Source,
            contexts.GetValueOrDefault(wordId),
            userWord.Emoji,
            userWord.ImageUrl);

        return (response, removedImage);
    }

    public async Task<(bool Cleared, string? RemovedImageUrl)> ClearVisualAsync(
        string userId,
        int wordId)
    {
        var userWord = await _context.UserWords
            .FirstOrDefaultAsync(uw => uw.UserId == userId && uw.WordId == wordId);

        if (userWord == null) return (false, null);

        var removedImage = userWord.ImageUrl;
        userWord.Emoji = null;
        userWord.ImageUrl = null;
        await _context.SaveChangesAsync();

        return (true, removedImage);
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

    private async Task<Dictionary<int, string?>> LoadContextsAsync(
        string userId,
        IEnumerable<int> wordIds)
    {
        var ids = wordIds.Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<int, string?>();

        var rows = await _context.Interactions
            .Where(i => i.UserId == userId
                        && i.WordId != null
                        && ids.Contains(i.WordId.Value)
                        && i.ContextSentence != null
                        && i.ContextSentence != "")
            .OrderByDescending(i => i.CreatedAt)
            .Select(i => new { i.WordId, i.ContextSentence })
            .ToListAsync();

        return rows
            .GroupBy(i => i.WordId!.Value)
            .ToDictionary(g => g.Key, g => g.First().ContextSentence);
    }

    private async Task<Dictionary<string, string>> LoadCategoryIconsAsync(
        IEnumerable<string> texts)
    {
        var normalized = texts
            .Where(text => !string.IsNullOrWhiteSpace(text))
            .Select(text => text.Trim().ToLowerInvariant())
            .Distinct()
            .ToList();

        if (normalized.Count == 0) return new Dictionary<string, string>();

        var rows = await _context.CategoryWords
            .AsNoTracking()
            .Where(word => word.Category.Icon != null
                           && normalized.Contains(word.English.ToLower()))
            .OrderBy(word => word.CategoryId)
            .Select(word => new { word.English, word.Category.Icon })
            .ToListAsync();

        return rows
            .Where(row => !string.IsNullOrWhiteSpace(row.Icon))
            .GroupBy(row => row.English, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => group.First().Icon!,
                StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Примеры из справочника WordLevels по тексту слова (R11).
    ///
    /// Отдельный запрос, а не Include: WordLevel связан с Word только текстом
    /// (navigation property нет), и тащить её в основной запрос словаря значило
    /// бы джойнить глобальную таблицу на 4500 строк ради двух колонок.
    /// Ключ — нижний регистр: в Words текст может прийти с заглавной («River»),
    /// в справочнике слово всегда в нижнем.
    /// </summary>
    private async Task<Dictionary<string, (string? Example, string? ExampleRu)>> LoadWordExamplesAsync(
        IEnumerable<string> texts)
    {
        var normalized = texts
            .Where(text => !string.IsNullOrWhiteSpace(text))
            .Select(text => text.Trim().ToLowerInvariant())
            .Distinct()
            .ToList();

        if (normalized.Count == 0) return new Dictionary<string, (string?, string?)>();

        var rows = await _context.WordLevels
            .AsNoTracking()
            .Where(level => normalized.Contains(level.Text) && level.Example != null)
            .Select(level => new { level.Text, level.Example, level.ExampleRu })
            .ToListAsync();

        return rows.ToDictionary(
            row => row.Text,
            row => (row.Example, row.ExampleRu),
            StringComparer.OrdinalIgnoreCase);
    }

    private static WordResponse MapToResponse(
        Word word,
        string? source = null,
        string? context = null,
        string? emoji = null,
        string? imageUrl = null,
        string? categoryIcon = null,
        string? example = null,
        string? exampleRu = null)
    {
        return new WordResponse(
            word.Id,
            word.Text,
            word.Language,
            word.Definitions
                .Where(d => !string.IsNullOrWhiteSpace(d.Definition))
                .OrderBy(d => d.DisplayOrder)
                .Select(d => new DefinitionResponse(
                    d.Id,
                    d.Definition,
                    d.PartOfSpeech,
                    d.Example
                ))
                .ToList(),
            word.CreatedAt,
            source,
            context,
            emoji,
            imageUrl,
            categoryIcon,
            example,
            exampleRu
        );
    }
}