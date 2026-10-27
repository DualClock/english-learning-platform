using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// Удаление аккаунта (W2.5.3) — правая часть обещания из /privacy.
///
/// Политика обещает «удаляется всё, включая файлы», и это единственный код,
/// который это обещание выполняет. Три решения, которые в нём главные:
///
/// 1. ПОДТВЕРЖДЕНИЕ ПАРОЛЕМ. Токен в куке — это «человек с этим браузером»,
///    а удаление необратимо: вместе с аккаунтом уходит очередь повторения,
///    которую человек собирал месяцами. Пароль требует не проверка полномочий
///    (она уже есть — [Authorize]), а отказ удалять по чужому клику, по
///    чужой незакрытой вкладке, по инерции.
///
/// 2. ЯВНЫЙ СПИСОК ТАБЛИЦ, а не «пусть каскад сам разберётся». Часть внешних
///    ключей в ApplicationDbContext действительно каскадирует на AspNetUsers,
///    но три из них не имеют ключа вообще: Books.UploadedByUserId,
///    AiUsageLogs.UserId и EmailMessages.UserId — обычные строки. Один
///    «delete user» оставил бы в базе книги, учёт токенов и копии писем
///    мёртвого человека. Поэтому удаляем каждую таблицу по имени, а тест
///    AccountDeletionTests (тест LeavesNoRowAnywhereReferencingTheUserId)
///    проходит по всей схеме и проверяет, что ни одна строка нигде не ссылается
///    на id удалённого пользователя — так новая таблица с UserId не сможет
///    молча пережить удаление.
///
/// 3. ФАЙЛЫ — ПОСЛЕ КОММИТА. Если удалить файлы до записи в базу, а база
///    откатится, человек потеряет книги, оставив строки, которые на них
///    ссылаются. После коммита ошибка удаления файла не может вернуть данные:
///    её только пишем в журнал.
///
/// Чего здесь сознательно НЕТ:
///  - гостевые события (GuestAnalyticsEvent) не трогаем: в них нет UserId,
///    только sha256(IP + суточная соль), это не данные конкретного человека,
///    и удаление аккаунта не может стирать статистику чужого прохода по /test;
///  - отзыва выданных токенов: механики нет в проекте (JWT подписывается
///    одним ключом, ревокейшн-списка и хранилища сессий на сервере нет — см.
///    security/risk-register.md R-01), поэтому access-токен живёт до
///    Jwt:ExpiryMinutes, а refresh — до Jwt:RefreshExpiryDays даже после
///    удаления аккаунта. Данные к этому моменту уже стёрты, так что токеном
///    нельзя ничего прочитать, но он ещё проходит [Authorize];
///  - «корзины восстановления на 30 дней»: обещание «удаляем сразу» дороже.
/// </summary>
[ApiController]
[Route("api/account")]
[Authorize]
public class AccountController : ControllerBase
{
    private readonly UserManager<User> _userManager;
    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;
    private readonly IMemoryCache _cache;
    private readonly ILogger<AccountController> _logger;

    public AccountController(
        UserManager<User> userManager,
        ApplicationDbContext context,
        IWebHostEnvironment environment,
        IMemoryCache cache,
        ILogger<AccountController> logger)
    {
        _userManager = userManager;
        _context = context;
        _environment = environment;
        _cache = cache;
        _logger = logger;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    /// <param name="Password">Текущий пароль аккаунта. Обязателен: без него
    /// удаление стало бы «одним кликом» для любой чужой незакрытой вкладки.</param>
    public record DeleteAccountDto(string? Password);

    // DELETE: api/account
    // Лимит «auth» (10/мин) — не про защиту от перебора пароля: она в самом
    // CheckPasswordAsync и в блокировке Identity. Здесь он гасит серии
    // случайных повторов и любопытство.
    [HttpDelete]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> DeleteAccount([FromBody] DeleteAccountDto? dto, CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();

        var user = await _userManager.FindByIdAsync(userId);

        // Второй вызов тем же токеном попадает сюда: JWT остаётся валидным,
        // пользователя в базе уже нет. Идемпотентность = 404, а не падение.
        if (user == null)
        {
            return NotFound(new { message = "Аккаунт не найден — возможно, он уже удалён." });
        }

        if (string.IsNullOrEmpty(dto?.Password))
        {
            return BadRequest(new { message = "Для удаления нужен текущий пароль." });
        }

        if (!await _userManager.CheckPasswordAsync(user, dto.Password))
        {
            // Ничего не удаляем и не трогаем: неверный пароль — это 401.
            _logger.LogWarning("Отклонено удаление аккаунта из-за пароля: {UserId}", userId);
            return Unauthorized(new { message = "Пароль не подошёл. Аккаунт не удалён." });
        }

        // Снимать пути файлов нужно ДО удаления строк: после коммита искать
        // «что принадлежало этому человеку» будет негде.
        var ownedBooks = await _context.Books
            .AsNoTracking()
            .Where(b => b.UploadedByUserId == userId)
            .Select(b => new OwnedBook(b.Id, b.FilePath, b.CoverUrl))
            .ToListAsync(cancellationToken);

        var wordImages = await _context.UserWords
            .AsNoTracking()
            .Where(w => w.UserId == userId && w.ImageUrl != null)
            .Select(w => w.ImageUrl!)
            .ToListAsync(cancellationToken);

        var avatarUrl = user.AvatarUrl;

        var bookIds = ownedBooks.Select(b => b.Id).ToArray();

        // Файлы, на которые ссылается кто-то ещё (общие SVG-обложки рассказов,
        // дубли загрузок), не удаляем: чужая библиотека не должна заметить,
        // что кто-то рядом вышел из сервиса.
        var referencedElsewhere = await _context.Books
            .AsNoTracking()
            .Where(b => b.UploadedByUserId != userId && !bookIds.Contains(b.Id))
            .Select(b => new { b.FilePath, b.CoverUrl })
            .ToListAsync(cancellationToken);

        var keep = new HashSet<string?>(
            referencedElsewhere.Select(x => x.FilePath).Concat(referencedElsewhere.Select(x => x.CoverUrl)),
            StringComparer.Ordinal);

        await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
        var rows = 0;
        try
        {
            rows = await DeleteUserDataAsync(_context, userId, cancellationToken);

            // ExecuteDeleteAsync обходит change tracker, поэтому после реестра
            // в нём остаются «unchanged» копии строк, которых в базе уже нет.
            // DeleteAsync снимает пользователя, и EF по каскаду помечает
            // удалёнными все привязанные к нему отслеживаемые зависимости — а
            // их строки уже стёрты, поэтому каждый такой DELETE даёт
            // DbUpdateConcurrencyException («Optimistic concurrency failure»)
            // и откат всего удаления. Трекер очищается ровно перед этим
            // вызовом: дальше единственный источник правды — база.
            _context.ChangeTracker.Clear();

            var identityResult = await _userManager.DeleteAsync(user);
            if (!identityResult.Succeeded)
            {
                await transaction.RollbackAsync(cancellationToken);
                _logger.LogWarning(
                    "Удаление аккаунта отменено Identity: {UserId} — {Errors}",
                    userId,
                    string.Join("; ", identityResult.Errors.Select(e => e.Description)));
                return BadRequest(new
                {
                    message = "Не удалось удалить аккаунт, данные на месте. Попробуйте ещё раз или напишите нам.",
                    errors = identityResult.Errors.Select(e => e.Description).ToArray(),
                });
            }

            await transaction.CommitAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            // Откат обязателен: частичное удаление хуже, чем никогда.
            await transaction.RollbackAsync(cancellationToken);
            _logger.LogError(ex, "Удаление аккаунта сорвалось и откатилось: {UserId}", userId);
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new { message = "Удаление не удалось — откатили всё, аккаунт и данные на месте." });
        }

        var files = DeleteUserFiles(ownedBooks, wordImages, avatarUrl, keep);

        _logger.LogInformation(
            "Аккаунт удалён: {UserId}, строк {Rows}, файлов {Files}",
            userId, rows, files);

        return Ok(new { message = "Аккаунт и все связанные данные удалены." });
    }

    /// <summary>
    /// Реестр таблиц, где лежат строки пользователя. Порядок — от детей к
    /// родителям: каскад в базе делает то же самое, но полагаться на него
    /// нельзя (см. комментарий к классу), а нам нужна одна гарантия — после
    /// прогона реестра в базе не остаётся ни одной строки с этим UserId.
    ///
    /// Реестр публичный не для красоты: тест CoversEveryTableThatHasAUserIdColumn
    /// сверяет его со списком типов модели EF, у которых есть колонка UserId или
    /// UploadedByUserId. Новая таблица с такой колонкой не сможет молча пережить
    /// удаление аккаунта — тест краснеет, пока её не добавят сюда.
    /// </summary>
    private delegate Task<int> DeleteUserRows(
        ApplicationDbContext context,
        string userId,
        CancellationToken cancellationToken);

    private static readonly IReadOnlyList<(string Table, DeleteUserRows Delete)> UserOwnedRows =
        new (string Table, DeleteUserRows Delete)[]
        {
            // Таблицы Identity: формально их снимает каскад от AspNetUsers, но
            // гарантия «удаляем сами, а не надеемся на провайдера» дешевле.
            ("UserRoles", (c, id, ct) => c.UserRoles.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("UserClaims", (c, id, ct) => c.UserClaims.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("UserLogins", (c, id, ct) => c.UserLogins.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("UserTokens", (c, id, ct) => c.UserTokens.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),

            // Словарь и всё, что на него ссылается
            ("UserWords", (c, id, ct) => c.UserWords.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("UserKnownWords", (c, id, ct) => c.UserKnownWords.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("ReviewLogs", (c, id, ct) => c.ReviewLogs.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("UserErrorBankEntries", (c, id, ct) => c.UserErrorBankEntries.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("Interactions", (c, id, ct) => c.Interactions.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),

            // Прогресс, статистика, геймификация
            ("DailyActivities", (c, id, ct) => c.DailyActivities.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("XpEvents", (c, id, ct) => c.XpEvents.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("LeagueHistories", (c, id, ct) => c.LeagueHistories.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("UserAchievements", (c, id, ct) => c.UserAchievements.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("UserGrammarProgresses", (c, id, ct) => c.UserGrammarProgresses.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("UserCategoryWordProgresses", (c, id, ct) => c.UserCategoryWordProgresses.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),

            // Интересы — персональные данные: по ним видно, чем человек
            // увлекается. /privacy обещает удаление, значит строки уходят.
            ("UserInterests", (c, id, ct) => c.UserInterests.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("UserBookProgresses", (c, id, ct) => c.UserBookProgresses.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("ReaderPocketWords", (c, id, ct) => c.ReaderPocketWords.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("AnalyticsEvents", (c, id, ct) => c.AnalyticsEvents.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),

            // Книги: закладки и маркерные слова — раньше самих книг. Подзапрос
            // вместо Include: ExecuteDelete не умеет JOIN, а correlated EXISTS
            // translates в обычный DELETE.
            ("BookBookmarks", (c, id, ct) => c.BookBookmarks.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("BookKeyWords", (c, id, ct) => c.BookKeyWords
                .Where(k => c.Books.Any(b => b.Id == k.BookId && b.UploadedByUserId == id))
                .ExecuteDeleteAsync(ct)),

            // Принадлежит человеку, но внешний ключ на AspNetUsers не имеет:
            // без этой строки книги умершего аккаунта остались бы в базе.
            ("Books", (c, id, ct) => c.Books.Where(x => x.UploadedByUserId == id).ExecuteDeleteAsync(ct)),

            // Служебное: учёт AI-вызовов и копии писем (включая отзывы с этим UserId)
            ("AiUsageLogs", (c, id, ct) => c.AiUsageLogs.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
            ("EmailMessages", (c, id, ct) => c.EmailMessages.Where(x => x.UserId == id).ExecuteDeleteAsync(ct)),
        };

    /// <summary>Имена DbSet, из которых удаляются строки пользователя.</summary>
    public static IReadOnlyCollection<string> UserOwnedTables { get; } =
        UserOwnedRows.Select(r => r.Table).ToArray();

    private static async Task<int> DeleteUserDataAsync(ApplicationDbContext context, string userId, CancellationToken cancellationToken)
    {
        var removed = 0;
        foreach (var (_, delete) in UserOwnedRows)
        {
            removed += await delete(context, userId, cancellationToken);
        }

        return removed;
    }

    /// <summary>
    /// Удаляет файлы владельца из uploads/. Работает только с именами файлов из
    /// собственных записей пользователя и только внутри известного подкаталога,
    /// поэтому не может задеть чужие загрузки: Path.GetFileName отрезает любые
    /// «../», а ссылки, которые живут у других книг, отсеивает HashSet keep.
    /// </summary>
    private int DeleteUserFiles(
        IReadOnlyList<OwnedBook> ownedBooks,
        IReadOnlyList<string> wordImages,
        string? avatarUrl,
        HashSet<string?> keep)
    {
        var removed = 0;

        foreach (var book in ownedBooks)
        {
            if (!string.IsNullOrEmpty(book.FilePath) && !keep.Contains(book.FilePath))
            {
                removed += TryDeleteUploadFile("books", book.FilePath) ? 1 : 0;
            }

            if (!string.IsNullOrEmpty(book.CoverUrl) && !keep.Contains(book.CoverUrl) && !IsSharedServiceAsset(book.CoverUrl))
            {
                removed += TryDeleteUploadFile("covers", book.CoverUrl) ? 1 : 0;
            }
        }

        foreach (var image in wordImages)
        {
            removed += TryDeleteUploadFile("word-images", image) ? 1 : 0;
        }

        removed += TryDeleteUploadFile("avatars", avatarUrl ?? string.Empty) ? 1 : 0;

        return removed;
    }

    /// <summary>
    /// SVG-обложки рассказов (uploads/covers/story-{index}.svg) генерирует
    /// StorySeeder и они принадлежат сервису, а не человеку, который добавил
    /// рассказ в свою полку: у тысячи пользователей файл один. Удалять его из-
    /// чужого выхода нельзя — даже если формально на момент удаления на него
    /// больше никто не ссылается.
    /// </summary>
    private static bool IsSharedServiceAsset(string url)
    {
        var name = Path.GetFileName(url);
        return name.StartsWith("story-", StringComparison.OrdinalIgnoreCase) &&
               name.EndsWith(".svg", StringComparison.OrdinalIgnoreCase);
    }

    private bool TryDeleteUploadFile(string subFolder, string url)    {
        var fileName = Path.GetFileName(url);
        if (string.IsNullOrEmpty(fileName)) return false;

        var deleted = false;
        foreach (var root in UploadRoots())
        {
            var path = Path.Combine(root, subFolder, fileName);
            if (!System.IO.File.Exists(path)) continue;

            try
            {
                System.IO.File.Delete(path);
                deleted = true;
            }
            catch (Exception ex)
            {
                // Файл мог быть занят или лежать на read-only томе. Данные в
                // базе уже удалены, поэтому остановиться и вернуть ошибку —
                // значит соврать пользователю об обратном: пишем в журнал
                // и идём дальше.
                _logger.LogWarning(ex, "Не удалось удалить файл загрузки: {Path}", path);
            }
        }

        return deleted;
    }

    /// <summary>
    /// BookService и FilesController пишут и читают от ContentRootPath,
    /// AvatarService и WordImageService — от текущего каталога процесса. В боевом
    /// контейнере это один путь, но чистить надо оба: иначе файл переживёт
    /// удалившего его владельца на стенде, где каталоги разошлись.
    /// </summary>
    private IEnumerable<string> UploadRoots()
    {
        var contentRoot = Path.Combine(_environment.ContentRootPath, "uploads");
        yield return contentRoot;

        var currentRoot = Path.Combine(Directory.GetCurrentDirectory(), "uploads");
        if (!string.Equals(currentRoot, contentRoot, StringComparison.OrdinalIgnoreCase))
        {
            yield return currentRoot;
        }
    }

    private sealed record OwnedBook(int Id, string FilePath, string? CoverUrl);
}
