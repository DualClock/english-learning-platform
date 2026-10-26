using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services.Guest;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Гостевой режим чтения (R2): гость открывает первую главу публичной книги
/// без аккаунта, кликает слово и видит перевод из справочника.
///
/// Почему отдельный контроллер, а не параметр у ReaderController: у того на
/// классе стоит [Authorize], и все его экшены работают от имени пользователя —
/// прогресс, карман, закладки. Здесь нет НИ ОДНОГО write-эндпоинта: ни
/// position, ни pocket, ни bookmark, ни finished, ни speech. Появление такого
/// действия в этом контроллере — регресс, и это проверяет тест
/// (GuestReaderTests.ReaderController_ExposesNoWriteEndpoint).
///
/// Границы, которые нельзя сдвинуть:
///  1. Каталог — только строки Books без владельца (GuestReaderCatalog),
///     поэтому чужая загруженная книга сюда не попадает ни по прямому слагу,
///     ни перебором;
///  2. Глава — ровно первая. Любой другой chapterId получает 403
///     `guest_only_first_chapter`, а не «главу, но урезанную»: урезанный текст
///     всё равно утёк бы в ответ.
///  3. Перевод — только WordLevels. AI в анонимном пути выключен целиком.
///
/// Лимит частоты. Политика `guest-reader` — по IP и заметно теснее `reader`
/// (см. NEEDS в отчёте: файл RateLimitPolicies.cs принадлежит другому
/// исполнителю). До её появления используется `guest-analytics` — тоже
/// анонимная, тоже по IP: у `reader` партиция строится по идентичности (IP +
/// email из тела), а на GET-запросах email нет, и все гости мира делили бы
/// одну корзину 240/мин.
/// </summary>
[ApiController]
[Route("api/guest")]
[AllowAnonymous]
public class GuestReaderController : ControllerBase
{
    /// <summary>
    /// Имя политики лимита, которой закрыт гостевой путь. Пока `guest-reader`
    /// не зарегистрирована в RateLimitPolicies (файл вне владения GuestReader),
    /// используется `guest-analytics` — единственная существующая анонимная
    /// политика с партицией по IP. У `reader` партиция строится по IP+email из
    /// тела, а на GET email нет: все гости мира делили бы одну корзину.
    /// </summary>
    public const string RateLimitPolicy = "guest-reader";

    /// <summary>Публичный адрес формы регистрации, куда ведёт CTA.</summary>
    public const string SignupUrl = "/onboarding";

    private readonly GuestReaderCatalog _catalog;
    private readonly GuestWordLookup _words;

    public GuestReaderController(GuestReaderCatalog catalog, GuestWordLookup words)
    {
        _catalog = catalog;
        _words = words;
    }

    /// <summary>GET api/guest/books — книги, открытые без аккаунта.</summary>
    [HttpGet("books")]
    [EnableRateLimiting("guest-analytics")]
    public async Task<IActionResult> GetBooks(CancellationToken ct)
    {
        var books = await _catalog.GetBooksAsync(ct);

        return Ok(new GuestBookListResponse
        {
            Total = books.Count,
            Books = books.ToList()
        });
    }

    /// <summary>
    /// GET api/guest/books/{slug} — манифест: книга, число глав, первая глава.
    /// 404 для неизвестного слага и для книги, загруженной пользователем:
    /// разница в ответах раскрывала бы существование чужой книги.
    /// </summary>
    [HttpGet("books/{slug}")]
    [EnableRateLimiting("guest-analytics")]
    public async Task<IActionResult> GetBook(string slug, CancellationToken ct)
    {
        var manifest = await _catalog.GetManifestAsync(slug, ct);
        if (manifest == null)
        {
            return NotFound(new { error = "guest_book_not_found" });
        }

        manifest.SignupUrl = SignupUrl;
        return Ok(manifest);
    }

    /// <summary>
    /// GET api/guest/books/{slug}/chapters/{chapterId} — глава. Только первая.
    /// Пустой chapterId читается как adres по умолчанию, а не как «все главы»:
    /// выбор делает сервер, а не параметр запроса.
    /// </summary>
    [HttpGet("books/{slug}/chapters/{chapterId}")]
    [EnableRateLimiting("guest-analytics")]
    public async Task<IActionResult> GetChapter(string slug, string chapterId, CancellationToken ct)
    {
        var (access, chapter) = await _catalog.GetChapterAsync(slug, chapterId, ct);

        switch (access)
        {
            case GuestChapterAccess.BookNotFound:
                return NotFound(new { error = "guest_book_not_found" });

            case GuestChapterAccess.NoText:
                // Книга в каталоге есть, файла нет: это не «глава 2», поэтому
                // 404 с отдельным кодом, а не 403.
                return NotFound(new { error = "guest_text_unavailable" });

            case GuestChapterAccess.OtherChapter:
                return StatusCode(StatusCodes.Status403Forbidden, new { error = "guest_only_first_chapter" });

            default:
                chapter!.ContinueUrl = SignupUrl;
                return Ok(chapter);
        }
    }

    /// <summary>
    /// GET api/guest/books/{slug}/words/{word} — перевод слова из справочника.
    /// Ответ приходит и для незнакомого слова: TranslationRu = null означает
    /// «перевода без аккаунта нет», а не ошибку.
    /// </summary>
    [HttpGet("books/{slug}/words/{word}")]
    [EnableRateLimiting("guest-analytics")]
    public async Task<IActionResult> LookupWord(string slug, string word, CancellationToken ct)
    {
        // Слаг проверяем до словаря: иначе метрика «в справочнике нет слова»
        // смешивалась бы с ответами на несуществующие книги.
        if (!await _catalog.ExistsAsync(slug, ct))
        {
            return NotFound(new { error = "guest_book_not_found" });
        }

        var lookup = await _words.LookupAsync(word, ct);
        if (lookup == null)
        {
            return BadRequest(new { error = "guest_word_invalid" });
        }

        lookup.SignupUrl = SignupUrl;
        return Ok(lookup);
    }
}
