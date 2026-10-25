using System.Security.Claims;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Controllers;

[ApiController]
[Route("api/reader")]
[Authorize]
public class ReaderController : ControllerBase
{
    /// <summary>Сколько предложений можно запросить за один раз. Глава целиком — 60–120.</summary>
    private const int MaxSpeechSegments = 160;

    private static readonly TimeSpan SpeechUrlTtl = TimeSpan.FromHours(2);

    private readonly ReaderContentService _content;
    private readonly ReaderProgressService _progress;
    private readonly ReaderPocketService _pocket;
    private readonly ReaderAssetService _assets;
    private readonly AzureSpeechService _azure;
    private readonly ApplicationDbContext _context;

    public ReaderController(
        ReaderContentService content,
        ReaderProgressService progress,
        ReaderPocketService pocket,
        ReaderAssetService assets,
        AzureSpeechService azure,
        ApplicationDbContext context)
    {
        _content = content;
        _progress = progress;
        _pocket = pocket;
        _assets = assets;
        _azure = azure;
        _context = context;
    }

    private string GetUserId() => User.FindFirst(ClaimTypes.NameIdentifier)?.Value!;

    [HttpGet("books/{bookId:int}")]
    public async Task<IActionResult> GetManifest(int bookId, CancellationToken cancellationToken)
    {
        var manifest = await _content.GetManifestAsync(GetUserId(), bookId, cancellationToken);
        return manifest == null ? NotFound() : Ok(manifest);
    }

    [HttpGet("books/{bookId:int}/chapters/{chapterId}")]
    public async Task<IActionResult> GetChapter(
        int bookId,
        string chapterId,
        CancellationToken cancellationToken)
    {
        var chapter = await _content.GetChapterAsync(GetUserId(), bookId, chapterId, cancellationToken);
        return chapter == null ? NotFound() : Ok(chapter);
    }

    [HttpPut("books/{bookId:int}/position")]
    [EnableRateLimiting("reader")]
    public async Task<IActionResult> UpdatePosition(
        int bookId,
        [FromBody] UpdateReaderPositionRequest? request,
        CancellationToken cancellationToken)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.ChapterId) ||
            string.IsNullOrWhiteSpace(request.SentenceId))
        {
            return BadRequest(new { error = "Нужны глава и предложение." });
        }

        var position = await _progress.UpdateAsync(GetUserId(), bookId, request, cancellationToken);
        return position == null ? NotFound() : Ok(position);
    }

    [HttpGet("books/{bookId:int}/pocket")]
    public async Task<IActionResult> GetPocket(int bookId, CancellationToken cancellationToken)
    {
        var pocket = await _pocket.GetForBookAsync(GetUserId(), bookId, cancellationToken);
        return pocket == null ? NotFound() : Ok(pocket);
    }

    [HttpPost("books/{bookId:int}/pocket")]
    [EnableRateLimiting("reader")]
    public async Task<IActionResult> UpsertPocket(
        int bookId,
        [FromBody] UpsertPocketWordRequest? request,
        CancellationToken cancellationToken)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Word))
        {
            return BadRequest(new { error = "Укажите слово." });
        }

        var item = await _pocket.UpsertAsync(GetUserId(), bookId, request, cancellationToken);
        return item == null
            ? BadRequest(new { error = "Слово не относится к этой главе." })
            : Ok(item);
    }

    [HttpDelete("pocket/{pocketId:int}")]
    public async Task<IActionResult> DeletePocket(int pocketId, CancellationToken cancellationToken)
    {
        var deleted = await _pocket.DeleteAsync(GetUserId(), pocketId, cancellationToken);
        return deleted ? NoContent() : NotFound();
    }

    [HttpGet("books/{bookId:int}/chapters/{chapterId}/review")]
    public async Task<IActionResult> GetReview(
        int bookId,
        string chapterId,
        [FromQuery] int limit = 8,
        CancellationToken cancellationToken = default)
    {
        var review = await _pocket.GetReviewAsync(GetUserId(), bookId, chapterId, limit, cancellationToken);
        return review == null ? NotFound() : Ok(review);
    }

    [HttpPost("pocket/{pocketId:int}/promote")]
    public async Task<IActionResult> Promote(int pocketId, CancellationToken cancellationToken)
    {
        var result = await _pocket.PromoteAsync(GetUserId(), pocketId, cancellationToken);
        return result == null
            ? NotFound()
            : Ok(new { added = result.Value.Added, word = result.Value.Word });
    }

    [HttpPost("pocket/{pocketId:int}/known")]
    public async Task<IActionResult> MarkKnown(int pocketId, CancellationToken cancellationToken)
    {
        var result = await _pocket.MarkKnownAsync(GetUserId(), pocketId, cancellationToken);
        return result == null
            ? NotFound()
            : Ok(new { known = result.Value.Known, word = result.Value.Word });
    }

    /// <summary>
    /// Список ссылок на озвучку предложений главы. Сам синтез здесь не
    /// происходит: клиент получает подписанные адреса и тянет звук по мере
    /// чтения, поэтому первый клик не ждёт всю главу.
    /// </summary>
    [HttpPost("books/{bookId:int}/chapters/{chapterId}/speech")]
    [EnableRateLimiting("reader")]
    public async Task<IActionResult> CreateSpeechManifest(
        int bookId,
        string chapterId,
        [FromBody] ReaderSpeechRequest? request,
        CancellationToken cancellationToken)
    {
        var chapter = await _content.GetChapterAsync(GetUserId(), bookId, chapterId, cancellationToken);
        if (chapter == null)
        {
            return NotFound();
        }

        if (!_azure.IsConfigured)
        {
            // Ключа нет — это не ошибка: клиент сразу берёт голос браузера.
            return Ok(new ReaderSpeechManifestDto { Available = false, Voice = _azure.Voice });
        }

        var sentences = chapter.Blocks.SelectMany(b => b.Sentences).ToList();
        var allowed = new HashSet<string>(sentences.Select(s => s.Id), StringComparer.Ordinal);
        var requested = (request?.SentenceIds ?? new List<string>())
            .Where(id => !string.IsNullOrWhiteSpace(id) && allowed.Contains(id))
            .Distinct(StringComparer.Ordinal)
            .Take(MaxSpeechSegments)
            .ToList();

        if (requested.Count == 0)
        {
            requested = sentences.Select(s => s.Id).Take(MaxSpeechSegments).ToList();
        }

        var now = DateTime.UtcNow;
        return Ok(new ReaderSpeechManifestDto
        {
            Available = true,
            Voice = _azure.Voice,
            Segments = requested.Select(id => new ReaderSpeechSegmentDto
            {
                SentenceId = id,
                Url = _assets.BuildSpeechUrl(bookId, chapter.Id, id, now, SpeechUrlTtl)
            }).ToList()
        });
    }

    /// <summary>
    /// Звук одного предложения. Тег audio не умеет присылать Authorization,
    /// поэтому доступ подтверждён подписью и сроком, а не JWT в ссылке.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting("reader")]
    [HttpGet("books/{bookId:int}/chapters/{chapterId}/speech/{sentenceId}")]
    public async Task<IActionResult> GetSpeech(
        int bookId,
        string chapterId,
        string sentenceId,
        [FromQuery] long exp,
        [FromQuery] string? sig,
        CancellationToken cancellationToken)
    {
        if (!_assets.ValidateSpeech(bookId, chapterId, sentenceId, exp, sig, DateTime.UtcNow))
        {
            return NotFound();
        }

        var snapshot = await _content.EnsureSnapshotAsync(bookId, cancellationToken);
        if (snapshot == null)
        {
            return NotFound();
        }

        var chapter = ReaderContentService.FindChapter(snapshot, chapterId);
        var sentence = chapter == null ? null : ReaderContentService.FindSentence(chapter, sentenceId);
        if (sentence == null)
        {
            return NotFound();
        }

        if (!_azure.IsConfigured)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "Озвучка не настроена." });
        }

        var clip = await _azure.SynthesizeAsync(sentence.Text, cancellationToken);
        if (clip == null)
        {
            // Лимит месяца или отказ провайдера: клиент тихо уходит на браузер.
            return StatusCode(StatusCodes.Status429TooManyRequests, new { error = "Лимит озвучки исчерпан." });
        }

        Response.Headers.CacheControl = "private, max-age=3600";
        return File(clip.Data, clip.ContentType);
    }

    /// <summary>Явное «Дочитано» в конце последней главы.</summary>
    [HttpPost("books/{bookId:int}/finished")]
    [EnableRateLimiting("reader")]
    public async Task<IActionResult> MarkFinished(
        int bookId,
        [FromBody] ReaderFinishRequest? request,
        CancellationToken cancellationToken)
    {
        var result = await _progress.MarkFinishedAsync(
            GetUserId(), bookId, request?.ChapterId, cancellationToken);

        return result == null
            ? BadRequest(new { error = "Закрыть книгу можно только на последней главе." })
            : Ok(result);
    }

    /// <summary>Словарная справка для листа слова: без страниц и без AI.</summary>
    [HttpGet("books/{bookId:int}/words/{word}")]
    public async Task<IActionResult> LookupWord(
        int bookId,
        string word,
        CancellationToken cancellationToken)
    {
        var owns = await _context.Books.AsNoTracking()
            .AnyAsync(b => b.Id == bookId && b.UploadedByUserId == GetUserId(), cancellationToken);
        if (!owns)
        {
            return NotFound();
        }

        var normalized = BookAnalyzerService.Normalize(word ?? string.Empty);
        if (normalized.Length < 2)
        {
            return BadRequest(new { error = "Слишком короткое слово." });
        }

        var level = await _context.WordLevels.AsNoTracking()
            .FirstOrDefaultAsync(wl => wl.Text == normalized, cancellationToken);

        return Ok(new ReaderWordLookupDto
        {
            Word = normalized,
            CefrLevel = level?.CefrLevel,
            TranslationRu = level?.TranslationRu,
            FreqRank = level?.FreqRank
        });
    }

    /// <summary>
    /// Картинка книги по подписанной ссылке. JWT в URL не кладём: он попал бы
    /// в журналы и историю, а подпись живёт ограниченное время и привязана
    /// к конкретному файлу.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("assets/{contentHash}/{name}")]
    public IActionResult GetAsset(
        string contentHash,
        string name,
        [FromQuery] long exp,
        [FromQuery] string? sig)
    {
        if (!_assets.Validate(contentHash, name, exp, sig, DateTime.UtcNow))
        {
            return NotFound();
        }

        var path = _assets.GetExistingPath(contentHash, name);
        if (path == null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "public, max-age=86400, immutable";
        return PhysicalFile(path, ReaderAssetService.ContentTypeFor(name));
    }
}
