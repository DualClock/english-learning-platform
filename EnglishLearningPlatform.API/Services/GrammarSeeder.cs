using System.Text.Json;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services;

public class GrammarSeedResult
{
    public bool AlreadySeeded { get; set; }
    public int UnitsCreated { get; set; }
    public int UnitsUpdated { get; set; }
    public int ExercisesSeeded { get; set; }
    public string? Error { get; set; }
}

public class GrammarSeeder
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private const string SeedFileRelativePath = "Data/Seed/grammar.json";

    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<GrammarSeeder> _logger;

    public GrammarSeeder(
        ApplicationDbContext context,
        IWebHostEnvironment environment,
        ILogger<GrammarSeeder> logger)
    {
        _context = context;
        _environment = environment;
        _logger = logger;
    }

    private string SeedFilePath => Path.Combine(_environment.ContentRootPath, SeedFileRelativePath);

    public async Task<GrammarSeedResult> SeedAsync()
    {
        var result = new GrammarSeedResult();

        // Поддержка нескольких файлов: grammar.json + grammar-wave*.json
        var seedDir = Path.Combine(_environment.ContentRootPath, "Data", "Seed");
        var seedFiles = Directory.Exists(seedDir)
            ? Directory.GetFiles(seedDir, "grammar*.json")
                .OrderBy(f => Path.GetFileName(f), StringComparer.OrdinalIgnoreCase)
                .ToList()
            : new List<string>();

        if (seedFiles.Count == 0)
        {
            result.Error = "Seed files not found in " + seedDir;
            return result;
        }

        var units = new List<SeedGrammarUnit>();
        foreach (var file in seedFiles)
        {
            try
            {
                await using var stream = File.OpenRead(file);
                var data = await JsonSerializer.DeserializeAsync<SeedFileData>(stream, JsonOptions);
                var fileUnits = data?.Units ?? new List<SeedGrammarUnit>();
                _logger.LogInformation("Grammar seed: {File} → {Count} units", Path.GetFileName(file), fileUnits.Count);
                units.AddRange(fileUnits);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to parse seed file {Path}", file);
                result.Error = "Failed to parse seed file: " + Path.GetFileName(file);
                return result;
            }
        }

        if (units.Count == 0)
        {
            result.Error = "Seed files contain no grammar units";
            return result;
        }

        var existingUnits = await _context.GrammarUnits
            .Include(gu => gu.Exercises)
            .ToListAsync();

        foreach (var seedUnit in units)
        {
            // Идемпотентность: юнит ищем по Order + Title
            var unit = existingUnits.FirstOrDefault(u =>
                u.Order == seedUnit.Order &&
                string.Equals(u.Title, seedUnit.Title, StringComparison.OrdinalIgnoreCase));

            if (unit == null)
            {
                unit = new GrammarUnit
                {
                    Order = seedUnit.Order,
                    Title = seedUnit.Title
                };
                _context.GrammarUnits.Add(unit);
                result.UnitsCreated++;
            }
            else
            {
                result.UnitsUpdated++;
            }

            unit.CefrLevel = seedUnit.CefrLevel;
            unit.Section = string.IsNullOrWhiteSpace(seedUnit.Section)
                ? DefaultSectionForOrder(seedUnit.Order)
                : seedUnit.Section;
            unit.TheoryHtml = seedUnit.TheoryHtml;
            unit.ShortDescription = seedUnit.ShortDescription;

            // Упражнения: пересобираем по Order, чтобы сид можно было менять
            var existingExercises = unit.Exercises.ToDictionary(e => e.Order);

            foreach (var seedExercise in seedUnit.Exercises)
            {
                var optionsJson = seedExercise.Options == null || seedExercise.Options.Count == 0
                    ? null
                    : JsonSerializer.Serialize(seedExercise.Options);

                if (existingExercises.TryGetValue(seedExercise.Order, out var exercise))
                {
                    exercise.Type = seedExercise.Type;
                    exercise.Prompt = seedExercise.Prompt;
                    exercise.OptionsJson = optionsJson;
                    exercise.CorrectAnswer = seedExercise.CorrectAnswer;
                    exercise.Explanation = seedExercise.Explanation;
                }
                else
                {
                    unit.Exercises.Add(new GrammarExercise
                    {
                        Order = seedExercise.Order,
                        Type = seedExercise.Type,
                        Prompt = seedExercise.Prompt,
                        OptionsJson = optionsJson,
                        CorrectAnswer = seedExercise.CorrectAnswer,
                        Explanation = seedExercise.Explanation
                    });
                    result.ExercisesSeeded++;
                }
            }
        }

        await _context.SaveChangesAsync();

        result.AlreadySeeded = result.UnitsCreated == 0 && result.ExercisesSeeded == 0;
        return result;
    }

    // Если в seed-файле раздел не указан — подставляем для стартовой восьмёрки
    private static string? DefaultSectionForOrder(int order) => order switch
    {
        1 or 2 => "Настоящее время",
        3 or 4 => "Существительные и артикли",
        5 or 6 => "Конструкции и модальность",
        7 or 8 => "Времена: продолженное и прошедшее",
        _ => null
    };

    private class SeedFileData
    {
        public List<SeedGrammarUnit> Units { get; set; } = new();
    }

    private class SeedGrammarUnit
    {
        public int Order { get; set; }
        public string Title { get; set; } = string.Empty;
        public string CefrLevel { get; set; } = string.Empty;
        public string? Section { get; set; }
        public string? TheoryHtml { get; set; }
        public string? ShortDescription { get; set; }
        public List<SeedGrammarExercise> Exercises { get; set; } = new();
    }

    private class SeedGrammarExercise
    {
        public int Order { get; set; }
        public string Type { get; set; } = string.Empty;
        public string Prompt { get; set; } = string.Empty;
        public List<string>? Options { get; set; }
        public string CorrectAnswer { get; set; } = string.Empty;
        public string? Explanation { get; set; }
    }
}
