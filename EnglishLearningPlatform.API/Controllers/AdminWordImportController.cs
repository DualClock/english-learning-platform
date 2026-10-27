using System.Text;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services.Import;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Массовый импорт слов в категорию из CSV или JSON.
///
/// Почему один эндпоинт с форматом по расширению файла, а не два: админ
/// выбирает файл в проводнике, и вопрос «это CSV или JSON» он решает тем,
/// что у него на диске. Требовать выбрать тип в интерфейсе — лишний шаг,
/// в котором легко ошибиться и получить «файл не разобрался».
///
/// Транзакция одна на весь импорт: половина записанных слов при сбое посередине
/// — это категория, которую нельзя ни откатить, ни догрузить (дубли упрутся
/// в уникальный индекс).
/// </summary>
[ApiController]
[Route("api/admin/content/categories/{categoryId:int}/words/import")]
[Authorize(Roles = "Admin")]
public class AdminWordImportController : ControllerBase
{
    /// <summary>
    /// Потолок файла. 5 МБ — это примерно 50 000 строк, что уже больше, чем
    /// разумный импорт слов за раз; больше — ошибка выбора файла.
    /// </summary>
    private const long MaxFileBytes = 5 * 1024 * 1024;

    // Только явные расширения. «.txt» НЕ принимается: под ним приходит что
    // угодно, включая случайно выбранный файл, и «импорт не разобрался»
    // превращается в разбор ошибок разбора чужого формата.
    private static readonly string[] CsvExtensions = { ".csv" };
    private static readonly string[] JsonExtensions = { ".json" };

    private readonly ApplicationDbContext _context;
    private readonly WordImportParser _parser;

    public AdminWordImportController(ApplicationDbContext context, WordImportParser parser)
    {
        _context = context;
        _parser = parser;
    }

    private string? CurrentUserId => User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

    /// <summary>
    /// Разобрать файл и записать слова.
    /// <c>dryRun=true</c> — только разбор и отчёт, без записи.
    /// </summary>
    [HttpPost]
    [RequestSizeLimit(MaxFileBytes + 64 * 1024)]
    public async Task<IActionResult> Import(
        int categoryId,
        IFormFile? file,
        CancellationToken ct = default,
        [FromQuery] bool dryRun = false)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "Файл не передан" });

        if (file.Length > MaxFileBytes)
            return BadRequest(new { error = $"Файл больше {MaxFileBytes / 1024 / 1024} МБ" });

        var fileName = file.FileName ?? string.Empty;
        var extension = Path.GetExtension(fileName).ToLowerInvariant();

        var isCsv = CsvExtensions.Contains(extension);
        var isJson = JsonExtensions.Contains(extension);

        if (!isCsv && !isJson)
            return BadRequest(new { error = "Поддерживаются файлы .csv и .json" });
        var category = await _context.Categories
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.Id == categoryId, ct);

        if (category == null)
            return NotFound(new { error = "Категория не найдена" });

        if (category.DeletedAt != null)
            return NotFound(new { error = "Категория удалена — сначала восстановите её" });

        string content;
        try
        {
            using var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            content = await reader.ReadToEndAsync(ct);
        }
        catch (Exception ex)
        {
            // Файл мог быть отдан не как UTF-8; говорим об этом прямо, потому
            // что иначе админ увидит «кракозябры» уже в базе.
            return BadRequest(new { error = $"Не удалось прочитать файл: {ex.Message}" });
        }

        var parsed = isJson ? _parser.ParseJson(content) : _parser.ParseCsv(content);

        // Что уже есть в категории. Сравнение без учёта регистра: «Apple» и
        // «apple» для ученика одно слово, и два ряда в словаре — это баг.
        var existing = await _context.CategoryWords
            .Where(w => w.CategoryId == categoryId)
            .Select(w => w.English)
            .ToListAsync(ct);

        var existingSet = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);

        var toAdd = new List<WordImportRow>();
        var skipped = 0;

        foreach (var row in parsed.Rows)
        {
            if (!existingSet.Add(row.English))
            {
                // Уже было в базе или повторилось внутри файла (парсер это
                // ловит предупреждением, но дубль мог прийти и между файлом
                // и базой).
                skipped++;
                continue;
            }

            toAdd.Add(row);
        }

        if (!dryRun && toAdd.Count > 0)
        {
            foreach (var row in toAdd)
            {
                _context.CategoryWords.Add(new CategoryWord
                {
                    CategoryId = categoryId,
                    English = row.English,
                    Translation = row.Translation,
                    Transcription = row.Transcription,
                    Example = row.Example,
                });
            }

            // Одна транзакция: половина записанных слов при сбое посередине
            // не откатывается и не догружается — дубли упрутся в индекс.
            await using var transaction = await _context.Database.BeginTransactionAsync(ct);
            try
            {
                await _context.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
            }
            catch (DbUpdateException ex)
            {
                await transaction.RollbackAsync(ct);
                return Conflict(new
                {
                    error = "Импорт отменён: часть слов конфликтует с существующими. Ничего не записано.",
                    detail = ex.InnerException?.Message,
                });
            }
        }

        return Ok(new
        {
            categoryId,
            dryRun,
            added = toAdd.Count,
            skipped,
            // Ошибки и предупреждения с номерами строк — иначе админ не найдёт
            // проблемное место в файле.
            errors = parsed.Errors.Select(e => new { line = e.Line, message = e.Message }),
            warnings = parsed.Warnings.Select(w => new { line = w.Line, message = w.Message }),
        });
    }
}
