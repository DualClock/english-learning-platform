using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

public class WordListSeedResult
{
    public bool AlreadySeeded { get; set; }
    public int WordLevelsSeeded { get; set; }
    public int ListsCreated { get; set; }
    public string? Error { get; set; }
}

public class WordListSeeder
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private const string SeedFileRelativePath = "Data/Seed/wordlists.json";

    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<WordListSeeder> _logger;

    public WordListSeeder(
        ApplicationDbContext context,
        IWebHostEnvironment environment,
        ILogger<WordListSeeder> logger)
    {
        _context = context;
        _environment = environment;
        _logger = logger;
    }

    private string SeedFilePath => Path.Combine(_environment.ContentRootPath, SeedFileRelativePath);

    public async Task<WordListSeedResult> SeedAsync()
    {
        var result = new WordListSeedResult();

        if (!File.Exists(SeedFilePath))
        {
            result.Error = "Seed file not found: " + SeedFileRelativePath;
            return result;
        }

        SeedFileData? data;
        try
        {
            await using var stream = File.OpenRead(SeedFilePath);
            data = await JsonSerializer.DeserializeAsync<SeedFileData>(stream, JsonOptions);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read seed file {Path}", SeedFilePath);
            result.Error = "Failed to parse seed file";
            return result;
        }

        var levels = data?.WordLevels ?? new List<SeedWordLevel>();
        if (levels.Count == 0)
        {
            result.Error = "Seed file contains no word levels";
            return result;
        }

        // Upsert WordLevels по Text
        var texts = levels.Select(l => l.Text).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var existing = await _context.WordLevels
            .Where(wl => texts.Contains(wl.Text))
            .ToDictionaryAsync(wl => wl.Text, StringComparer.OrdinalIgnoreCase);

        foreach (var level in levels)
        {
            if (existing.TryGetValue(level.Text, out var wordLevel))
            {
                wordLevel.CefrLevel = level.Cefr;
                wordLevel.FreqRank = level.Rank;
                if (!string.IsNullOrWhiteSpace(level.Ru))
                {
                    wordLevel.TranslationRu = level.Ru;
                }
            }
            else
            {
                _context.WordLevels.Add(new WordLevel
                {
                    Text = level.Text,
                    CefrLevel = level.Cefr,
                    FreqRank = level.Rank,
                    TranslationRu = level.Ru
                });
                result.WordLevelsSeeded++;
            }
        }

        await _context.SaveChangesAsync();

        // Сборники
        var listNames = new[]
        {
            "Essential 1000",
            "Core 3000",
            "Advanced 1000"
        };

        var existingLists = await _context.WordLists
            .Where(wl => listNames.Contains(wl.Name))
            .ToListAsync();

        var byRank = levels.OrderBy(l => l.Rank).ToList();
        var essential = byRank.Where(l => l.Rank <= 1000).ToList();
        var core = byRank.Where(l => l.Rank > 1000 && l.Rank <= 3500).ToList();
        var advanced = byRank
            .Where(l => l.Rank > 3500 && (l.Cefr == "b2" || l.Cefr == "c1" || l.Cefr == "c2"))
            .Take(1000)
            .ToList();

        var definitions = new (string Name, string? Description, string? CefrFrom, string? CefrTo, List<SeedWordLevel> Items)[]
        {
            ("Essential 1000",
                "1000 самых нужных английских слов — базовый словарь для начинающих. Этих слов хватит для понимания повседневных разговоров и простых текстов.",
                "a1", "b1", essential),
            ("Core 3000",
                "3000 ключевых слов английского языка — ядро повседневной речи. С этим словарём вы поймёте большинство фильмов, статей и книг среднего уровня.",
                "a1", "b2", core),
            ("Advanced 1000",
                "1000 продвинутых слов уровня B2–C2 — для уверенного владения языком, академических текстов и тонких оттенков смысла.",
                "b2", "c2", advanced)
        };

        foreach (var (name, description, cefrFrom, cefrTo, items) in definitions)
        {
            if (existingLists.Any(l => l.Name == name))
            {
                continue;
            }

            var list = new WordList
            {
                Name = name,
                Description = description,
                CefrFrom = cefrFrom,
                CefrTo = cefrTo,
                ItemCount = items.Count
            };

            foreach (var item in items)
            {
                list.Items.Add(new WordListItem
                {
                    WordText = item.Text,
                    CefrLevel = item.Cefr,
                    FreqRank = item.Rank
                });
            }

            _context.WordLists.Add(list);
            result.ListsCreated++;
        }

        await _context.SaveChangesAsync();

        result.AlreadySeeded = result.ListsCreated == 0 && result.WordLevelsSeeded == 0;
        return result;
    }

    private class SeedFileData
    {
        public DateTime GeneratedAt { get; set; }
        public List<SeedWordLevel> WordLevels { get; set; } = new();
    }

    private class SeedWordLevel
    {
        public string Text { get; set; } = string.Empty;
        public string Cefr { get; set; } = string.Empty;
        public int Rank { get; set; }
        public string? Ru { get; set; }
    }
}
