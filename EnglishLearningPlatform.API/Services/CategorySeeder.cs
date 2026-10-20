using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

public class CategorySeedResult
{
    public bool AlreadySeeded { get; set; }
    public int CategoriesCreated { get; set; }
    public int WordsCreated { get; set; }
    public string? Error { get; set; }
}

public class CategorySeeder
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private const string SeedFileRelativePath = "Data/Seed/categories.json";

    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<CategorySeeder> _logger;

    public CategorySeeder(
        ApplicationDbContext context,
        IWebHostEnvironment environment,
        ILogger<CategorySeeder> logger)
    {
        _context = context;
        _environment = environment;
        _logger = logger;
    }

    private string SeedFilePath => Path.Combine(_environment.ContentRootPath, SeedFileRelativePath);

    public async Task<CategorySeedResult> SeedAsync()
    {
        var result = new CategorySeedResult();

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

        var categories = data?.Categories ?? new List<SeedCategory>();
        if (categories.Count == 0)
        {
            result.Error = "Seed file contains no categories";
            return result;
        }

        var slugs = categories.Select(c => c.Slug).ToList();
        var existing = await _context.Categories
            .Include(c => c.Words)
            .Where(c => slugs.Contains(c.Slug))
            .ToListAsync();

        foreach (var seed in categories)
        {
            var current = existing.FirstOrDefault(c => c.Slug == seed.Slug);

            if (current != null)
            {
                // Категория уже есть: дописываем только новые слова, чтобы
                // расширение сид-файла доезжало и до существующих баз
                var known = current.Words
                    .Select(w => w.English)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);

                foreach (var word in seed.Words.Where(w => !known.Contains(w.English)))
                {
                    current.Words.Add(new CategoryWord
                    {
                        English = word.English,
                        Translation = word.Translation,
                        Transcription = word.Transcription,
                        Example = word.Example
                    });
                    result.WordsCreated++;
                }

                continue;
            }

            var category = new Category
            {
                Name = seed.Name,
                Slug = seed.Slug,
                Icon = seed.Icon,
                Color = seed.Color,
                Description = seed.Description
            };

            foreach (var word in seed.Words)
            {
                category.Words.Add(new CategoryWord
                {
                    English = word.English,
                    Translation = word.Translation,
                    Transcription = word.Transcription,
                    Example = word.Example
                });
                result.WordsCreated++;
            }

            _context.Categories.Add(category);
            result.CategoriesCreated++;
        }

        await _context.SaveChangesAsync();

        result.AlreadySeeded = result.CategoriesCreated == 0 && result.WordsCreated == 0;
        return result;
    }

    private class SeedFileData
    {
        public List<SeedCategory> Categories { get; set; } = new();
    }

    private class SeedCategory
    {
        public string Name { get; set; } = string.Empty;
        public string Slug { get; set; } = string.Empty;
        public string? Icon { get; set; }
        public string? Color { get; set; }
        public string? Description { get; set; }
        public List<SeedWord> Words { get; set; } = new();
    }

    private class SeedWord
    {
        public string English { get; set; } = string.Empty;
        public string Translation { get; set; } = string.Empty;
        public string? Transcription { get; set; }
        public string? Example { get; set; }
    }
}
