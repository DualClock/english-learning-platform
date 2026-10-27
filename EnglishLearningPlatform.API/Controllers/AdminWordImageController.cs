using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Security;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Media;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Загрузка картинки для слова категории.
///
/// Почему отдельный контроллер, а не поле в <see cref="AdminContentController"/>:
/// здесь multipart, декодирование изображения и запись на диск — другой класс
/// ошибок и другой лимит частоты. Смешивать это с JSON-эндпоинтами значит
/// тащить конфигурацию форм-лимитов в каждый метод.
///
/// Правила, которые обеспечивает сервер (не UI):
///
///  1. Роль Admin — атрибутом на классе.
///  2. Принимаем только настоящую картинку: расширение и Content-Type приходят
///     от клиента и подделываются в один curl. Проверка идёт по сигнатуре файла
///     и по декодированию ImageSharp — «PHP под видом .jpg» отваливается.
///  3. Размер ограничен до декодирования (иначе 200 МБ прочитаются в память).
///  4. Файл пересохраняется в WebP и урезается до разумного размера: это
///     карточка слова, а не обои. Так же лежат готовые иллюстрации в public/words.
///  5. Имя файла генерируется сервером. Имя от клиента — это путь, по которому
///     можно уйти в ../../ и записать что угодно.
/// </summary>
[ApiController]
[Route("api/admin/content/words")]
[Authorize(Roles = AppRoles.Admin)]
[EnableRateLimiting("upload")]
public class AdminWordImageController : ControllerBase
{
    // 8 МБ: снимок с телефона влезает, RAW и «скрин всей страницы 4K» — нет.
    private const long MaxUploadBytes = 8 * 1024 * 1024;

    // Карточка показывает картинку до 208 px (lg во флэшкарте). 512 — запас
    // под retina без пересушки.
    private const int MaxEdge = 512;

    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;
    private readonly IMediaStorage _media;
    private readonly ILogger<AdminWordImageController> _logger;

    public AdminWordImageController(
        ApplicationDbContext context,
        IWebHostEnvironment environment,
        IMediaStorage media,
        ILogger<AdminWordImageController> logger)
    {
        _context = context;
        _environment = environment;
        _media = media;
        _logger = logger;
    }

    private string AdminId =>
        User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "admin";

    private static string WordImagesDirectory(IWebHostEnvironment environment) =>
        Path.Combine(environment.ContentRootPath, "uploads", "word-images");

    /// <summary>
    /// Загрузить картинку слову. Возвращает относительный URL, который кладётся
    /// в <c>CategoryWord.ImageUrl</c> и переживает перезапуск.
    /// </summary>
    [HttpPost("{id:int}/image")]
    [RequestSizeLimit(MaxUploadBytes + 1024)]
    public async Task<ActionResult<object>> UploadImage(int id, IFormFile? file, CancellationToken ct)
    {
        if (file == null || file.Length == 0)
        {
            return BadRequest(new { message = "Файл не передан." });
        }

        if (file.Length > MaxUploadBytes)
        {
            return BadRequest(new { message = "Картинка больше 8 МБ — уменьшите и попробуйте снова." });
        }

        // CategoryWord без глобального фильтра: удалённое слово находится
        // запросом, поэтому проверяем состояние явно.
        var word = await _context.CategoryWords.FirstOrDefaultAsync(w => w.Id == id, ct);
        if (word == null) return NotFound(new { message = "Слово не найдено." });
        if (word.DeletedAt != null) return BadRequest(new { message = "Слово удалено — сначала восстановите." });

        var directory = WordImagesDirectory(_environment);
        Directory.CreateDirectory(directory);

        // Кодируем в память, а не сразу на диск: хранилище принимает поток,
        // и заодно мы не оставляем недописанный файл, если ImageSharp упадёт
        // на середине. Картинка — до 512 px, это десятки килобайт.
        MediaFile stored;

        try
        {
            await using var input = file.OpenReadStream();

            // ImageSharp читает заголовок и решает, картинка ли это. Битый или
            // не-картиночный файл бросит UnknownImageFormatException — до записи
            // в хранилище, поэтому мусор туда не попадёт.
            using var image = await Image.LoadAsync(input, ct);

            if (image.Width < 16 || image.Height < 16)
            {
                return BadRequest(new { message = "Картинка меньше 16×16 — не разглядеть в карточке." });
            }

            // Пропорции сохраняются: вариант «обрезать по квадрату» испортил бы
            // вертикальные предметы (бутылка, дерево).
            image.Mutate(x => x.Resize(new ResizeOptions
            {
                Size = new Size(MaxEdge, MaxEdge),
                Mode = ResizeMode.Max
            }));

            using var encoded = new MemoryStream();
            await image.SaveAsync(encoded, new WebpEncoder { Quality = 82 }, ct);
            encoded.Position = 0;

            // Имя генерирует хранилище: клиентское имя — это обход пути и
            // подмена чужого файла.
            stored = await _media.SaveAsync("word-images", encoded, ".webp", ct);
        }
        catch (UnknownImageFormatException)
        {
            _logger.LogWarning("Отклонена загрузка картинки для слова {WordId}: не изображение", id);
            return BadRequest(new { message = "Это не изображение. Поддерживаются JPG, PNG, WebP, GIF." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Не удалось обработать картинку для слова {WordId}", id);
            return BadRequest(new { message = "Не удалось обработать картинку." });
        }

        var previous = word.ImageUrl;
        word.ImageUrl = stored.PublicUrl;
        await _context.SaveChangesAsync(ct);

        // Старый файл удаляем после успешной записи: если SaveChanges упадёт,
        // слово должно остаться с рабочей картинкой, а не с битой ссылкой.
        await _media.DeleteAsync(previous, ct);

        _logger.LogInformation(
            "Админ {AdminId} загрузил картинку для слова {WordId}: {Url}",
            AdminId, id, word.ImageUrl);

        return Ok(new { word.Id, imageUrl = word.ImageUrl });
    }

    /// <summary>Убрать картинку: поле очищается, файл удаляется.</summary>
    [HttpDelete("{id:int}/image")]
    public async Task<ActionResult<object>> DeleteImage(int id, CancellationToken ct)
    {
        var word = await _context.CategoryWords.FirstOrDefaultAsync(w => w.Id == id, ct);
        if (word == null) return NotFound(new { message = "Слово не найдено." });

        var previous = word.ImageUrl;
        word.ImageUrl = null;
        await _context.SaveChangesAsync(ct);

        await _media.DeleteAsync(previous, ct);
        _logger.LogInformation("Админ {AdminId} убрал картинку у слова {WordId}", AdminId, id);

        return Ok(new { word.Id, imageUrl = (string?)null });
    }

}
