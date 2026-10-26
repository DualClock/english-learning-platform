using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace EnglishLearningPlatform.API.Services.Guest;

/*
 * Сидер публичных копий книг — то, чего в продукте не было.
 *
 * Гостевой режим (GuestReaderCatalog) показывает только строки Books с
 * UploadedByUserId == null: ослаблять проверку владельца нельзя, она охраняет
 * чужие EPUB. Но до этого класса системных копий не создавал НИКТО:
 *
 *   - POST /api/books/story/{index}  → книга с UploadedByUserId = автор;
 *   - POST /api/books/popular/{id}   → книга с UploadedByUserId = автор;
 *   - PublicCatalogService берёт классику из списка в коде, а в таблицу Books
 *     не пишет вовсе («сегодня таких строк нет» — его собственный комментарий).
 *
 * Итог до этого класса: гостевая витрина всегда пустая, а /reader/preview/<slug>
 * открывается только если системную строку завели руками в SQL. Именно так
 * случился провал локального GO-гейта: глава по слагу отдавалась (резолв идёт
 * по тому же списку), а список книг был пуст, потому что строк не было.
 *
 * Что делает сидер:
 *   1. Кладёт РАСсказы из Data/Seed/stories.json как строки без владельца
 *      (файл EPUB генерируется тем же StorySeeder.WriteEpub, что и для
 *      пользовательских копий — один формат, один разборщик).
 *   2. Ничего не дублирует: если строка с таким заголовком и
 *      UploadedByUserId == null уже есть, шаг пропускается. Повторный запуск
 *      безопасен, поэтому сидер вызывается на старте.
 *   3. Не трогает пользовательские копии тех же рассказов: у человека право
 *      на свой прогресс, закладки и карман. Системная копия — отдельная строка.
 *
 * Запускается только в Development (см. Program.cs): на проде контент
 * системных копий появляется осознанным шагом деплоя, а не при каждом старте.
 */
public class GuestCatalogSeeder
{
    private readonly ApplicationDbContext _context;
    private readonly StorySeeder _stories;
    private readonly IHostEnvironment _environment;
    private readonly ILogger<GuestCatalogSeeder> _logger;

    public GuestCatalogSeeder(
        ApplicationDbContext context,
        StorySeeder stories,
        IHostEnvironment environment,
        ILogger<GuestCatalogSeeder> logger)
    {
        _context = context;
        _stories = stories;
        _environment = environment;
        _logger = logger;
    }

    public sealed record Result(int Created, int Skipped);

    /// <summary>
    /// Создаёт недостающие системные копии рассказов. Идемпотентно.
    /// </summary>
    public async Task<Result> SeedAsync(CancellationToken ct = default)
    {
        var stories = _stories.GetStories();
        if (stories.Count == 0)
        {
            return new Result(0, 0);
        }

        // Один запрос на все заголовки, а не N запросов в цикле: старт API не
        // должен линейно зависеть от размера каталога.
        var titles = stories.Select(s => s.Title).ToList();
        var existing = await _context.Books.AsNoTracking()
            .Where(b => b.UploadedByUserId == null && titles.Contains(b.Title))
            .Select(b => b.Title)
            .ToListAsync(ct);

        var present = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);
        var uploads = Path.Combine(_environment.ContentRootPath, "uploads", "books");
        Directory.CreateDirectory(uploads);

        var created = 0;
        var skipped = 0;

        for (var index = 0; index < stories.Count; index++)
        {
            var story = stories[index];
            if (present.Contains(story.Title))
            {
                skipped++;
                continue;
            }

            var fileName = $"{Guid.NewGuid()}.epub";
            var filePath = Path.Combine(uploads, fileName);

            try
            {
                // Тот же генератор EPUB, что у пользовательской копии: файл
                // обязан читаться тем же BookSnapshotParser, иначе гостевая
                // глава окажется пустой при живом списке.
                StorySeeder.WriteEpub(story, filePath);

                _context.Books.Add(new Book
                {
                    Title = story.Title,
                    Author = story.Author,
                    Language = "en",
                    Description = story.Description,
                    CefrLevel = story.CefrLevel,
                    FilePath = fileName,
                    FileSize = new FileInfo(filePath).Length,
                    CoverUrl = _stories.EnsureCoverUrl(index, story),
                    // Ключевая строка: без владельца = публичная копия.
                    UploadedByUserId = null,
                    CreatedAt = DateTime.UtcNow
                });

                created++;
            }
            catch (Exception ex)
            {
                // Один битый рассказ не должен мешать остальным и не должен
                // валить старт API: остальные разделы работают и без него.
                _logger.LogError(ex, "Гостевая копия рассказа «{Title}» не создана", story.Title);
                TryDelete(filePath);
            }
        }

        if (created > 0)
        {
            await _context.SaveChangesAsync(ct);
        }

        _logger.LogInformation(
            "Гостевой каталог: создано {Created}, уже было {Skipped}",
            created,
            skipped);

        return new Result(created, skipped);
    }

    private void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Не удалось удалить недописанный EPUB {Path}", path);
        }
    }
}
