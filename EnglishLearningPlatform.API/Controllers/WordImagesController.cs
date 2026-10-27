using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Отдача картинок слов из категорий.
///
/// Отдельный контроллер, потому что <c>FilesController.GetWordImage</c> отдаёт
/// ЛИЧНЫЕ картинки: он проверяет владение строкой UserWord. Картинка категории
/// — общий контент: её видит любой читатель категории, и проверять владельца
/// там нечего.
///
/// Раздача идёт только из каталога word-images, имя файла — строго guid.webp
/// (формат, в котором административный загрузчик сохраняет файлы). Никаких
/// «../»: регулярка не пропускает ни слэши, ни точки кроме разделителя
/// расширения.
/// </summary>
[ApiController]
[Route("api/word-images")]
public class WordImagesController : ControllerBase
{
    private static readonly System.Text.RegularExpressions.Regex SafeName =
        new(@"^[a-f0-9]{32}\.webp$", System.Text.RegularExpressions.RegexOptions.Compiled);

    private readonly IWebHostEnvironment _environment;

    public WordImagesController(IWebHostEnvironment environment)
    {
        _environment = environment;
    }

    [HttpGet("{fileName}")]
    public IActionResult Get(string fileName)
    {
        if (!SafeName.IsMatch(fileName)) return NotFound();

        var path = Path.Combine(_environment.ContentRootPath, "uploads", "word-images", fileName);
        if (!System.IO.File.Exists(path)) return NotFound();

        // Картинка слова не меняется после загрузки: имя — guid. Поэтому её
        // можно кэшировать надолго, в отличие от личных картинок пользователя.
        Response.Headers.CacheControl = "public, max-age=604800, immutable";
        return PhysicalFile(path, "image/webp");
    }
}
