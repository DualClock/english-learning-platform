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
///    AccountDeletionOrphansTests проходит по всей схеме и проверяет, что ни
///    одна строка нигде не ссылается на id удалённого пользователя — так
///    новая таблица с UserId не сможет молча пережить удаление.
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
            rows = await DeleteUserDataAsync(userId, bookIds, cancellationToken);

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

        // Сессии чтения живут в памяти процесса (IMemoryCache, TTL 12 ч), а не
        // в базе: без этой чистки собранные слова пережили бы владельца до
        // конца TTL.
        ClearReadingSessions(userId);

        _logger.LogInformation(
            "Аккаунт удалён: {UserId}, строк {Rows}, файлов {Files}",
            userId, rows, files);

        return Ok(new { message = "Аккаунт и все связанные данные удалены." });
    }

    /// <summary>
    /// Все строки пользователя одной последовательностью. Порядок — от детей к
    /// родителям: каскад в базе делает то же самое, но полагаться на него
    /// нельзя (см. комментарий к классу), а нам важна одна гарантия — после
    /// этого метода в базе не остаётся ни одной строки с этим UserId.
    /// </summary>
    private async Task<int> DeleteUserDataAsync(string userId, int[] bookIds, CancellationToken cancellationToken)
    {
        var removed = 0;

        // Словарь и всё, что на него ссылается
        removed += await _context.UserWords.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.UserKnownWords.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.ReviewLogs.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.UserErrorBankEntries.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.Interactions.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);

        // Прогресс, статистика, геймификация
        removed += await _context.DailyActivities.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.XpEvents.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.LeagueHistories.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.UserAchievements.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.UserGrammarProgresses.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.UserCategoryWordProgresses.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.AnalyticsEvents.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);

        // Книги: закладки и маркерные слова — раньше самих книг
        removed += await _context.BookBookmarks.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        if (bookIds.Length > 0)
        {
            removed += await _context.BookKeyWords.Where(x => bookIds.Contains(x.BookId))
                .ExecuteDeleteAsync(cancellationToken);
        }
        removed += await _context.Books.Where(x => x.UploadedByUserId == userId)
            .ExecuteDeleteAsync(cancellationToken);

        // Служебное: учёт AI-вызовов и копии писем (включая отзывы с этим UserId)
        removed += await _context.AiUsageLogs.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        removed += await _context.EmailMessages.Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);

        // Роли, клеймы, внешние логины и токены Identity — их снимает
        // UserManager.DeleteAsync вместе со строкой пользователя.
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

            if (!string.IsNullOrEmpty(book.CoverUrl) && !keep.Contains(book.CoverUrl))
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

    private bool TryDeleteUploadFile(string subFolder, string url)
    {
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

    private void ClearReadingSessions(string userId)
    {
        if (_cache.TryGetValue(ReadingSessionController.UserSessionsKey(userId), out List<Guid>? sessionIds)
            && sessionIds != null)
        {
            foreach (var sessionId in sessionIds)
            {
                _cache.Remove(ReadingSessionController.SessionKey(sessionId));
            }

            _cache.Remove(ReadingSessionController.UserSessionsKey(userId));
        }
    }

    private sealed record OwnedBook(int Id, string FilePath, string? CoverUrl);
}
