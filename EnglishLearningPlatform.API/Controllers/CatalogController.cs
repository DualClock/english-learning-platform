using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Анонимный read-слой публичной витрины книг.
///
/// Зачем он вообще существует: лендинг и посты в Telegram ведут на конкретную
/// книгу («Алиса в стране чудес с переводом»), а единственный адрес книги в
/// продукте был приватным — /books требует сессию. Этот контроллер отдаёт ровно
/// то, что и так видно на публичной полке: название, автор, уровень, объём,
/// описание, обложка, слаг и короткое начало.
///
/// Границы, которые нельзя переступить:
///  - [AllowAnonymous] здесь осознанный: ни один ответ не зависит от пользователя
///    и не содержит чужих данных. Авторизация не нужна, но и приватность не
///    отменяется — список полей закрыт типом PublicBookDto (тест проверяет, что
///    в нём нет FilePath и UploadedByUserId);
///  - в каталог попадают только сиды и строки Books без владельца
///    (см. PublicCatalogService);
///  - книга, которую загрузил пользователь, отвечает 404 даже по прямому слагу;
///  - ответа нет ни в одном пути к AI: тяжёлого здесь нет ничего, кроме
///    разового чтения EPUB системной копии, и то за кэшем.
///
/// Дёшево ли это? Каталог целиком лежит в IMemoryCache (6 ч), поэтому запрос
/// краулера — это чтение из памяти. Повторная пересборка под семафором, так что
/// флуд неизвестными слагами не превращается в флуд распаковкой архивов.
/// </summary>
[ApiController]
[Route("api/catalog")]
[AllowAnonymous]
public class CatalogController : ControllerBase
{
    private readonly PublicCatalogService _catalog;

    public CatalogController(PublicCatalogService catalog)
    {
        _catalog = catalog;
    }

    /// <summary>
    /// GET: api/catalog/books — весь публичный каталог одним списком.
    /// Пагинация не нужна по той же причине, по какой её нет у книжной полки:
    /// записей десятки, а не тысячи, и SSR-странице /library нужен весь список
    /// сразу, чтобы разложить книги по уровням в одном HTML.
    /// </summary>
    [HttpGet("books")]
    public async Task<IActionResult> GetBooks(CancellationToken ct)
    {
        var books = await _catalog.GetCatalogAsync(ct);

        return Ok(new CatalogResponse(books.Count, books));
    }

    /// <summary>
    /// GET: api/catalog/books/{slug} — одна публичная книга.
    /// 404 для неизвестного слага — осознанный ответ вместо редиректа на
    /// каталог: страница книги, которой нет, не должна выглядеть как живая.
    /// </summary>
    [HttpGet("books/{slug}")]
    public async Task<IActionResult> GetBook(string slug, CancellationToken ct)
    {
        var book = await _catalog.FindAsync(slug, ct);

        if (book == null)
        {
            return NotFound(new { message = "Book not found" });
        }

        return Ok(new CatalogBookResponse(book));
    }
}
