using System.Security.Claims;
using EnglishLearningPlatform.API.Security;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearningPlatform.API.Controllers;

/// <summary>
/// AI-ассистент админки: черновик статьи и примеры к слову.
///
/// Почему отдельный контроллер, а не метод в ArticlesController: здесь
/// другая ответственность — не хранение статьи, а ГЕНЕРАЦИЯ текста, со своим
/// бюджетом, своим лимитом и своей причиной отказа. Смешать это со CRUD
/// значило бы, что ошибка AI-провайдера выглядит как ошибка сохранения.
///
/// Роль проверяется один раз на классе: забытый атрибут на новом методе —
/// это открытый расход чужого бюджета, и такая ошибка не должна быть возможна.
/// </summary>
[ApiController]
[Route("api/admin/assistant")]
[Authorize(Roles = "Admin")]
[RequireConfirmedEmail]
public class AdminAssistantController : ControllerBase
{
    private readonly AiService _ai;
    private readonly AiQuotaService _quota;

    public AdminAssistantController(AiService ai, AiQuotaService quota)
    {
        _ai = ai;
        _quota = quota;
    }

    /// <summary>Черновик статьи по теме.</summary>
    [HttpPost("article")]
    public async Task<IActionResult> Article(
        [FromBody] ArticleDraftRequest request,
        CancellationToken ct = default)
    {
        var topic = request?.Topic?.Trim();

        // Проверяем до провайдера: пустая тема — это «сгенерируй что-нибудь»,
        // и результат придётся выбросить. Деньги на воздух.
        if (string.IsNullOrWhiteSpace(topic))
            return BadRequest(new { error = "Укажите тему статьи" });

        if (topic.Length > 300)
            return BadRequest(new { error = "Тема длиннее 300 символов" });

        var quotaError = await CheckQuotaAsync();
        if (quotaError != null) return quotaError;

        var level = NormalizeLevel(request!.Level);
        var prompt = BuildArticlePrompt(topic, level, request.Audience);

        var text = await _ai.GenerateForAdminAsync(
            prompt, "admin-article", CurrentUserId, maxOutputTokens: 4096);

        if (string.IsNullOrWhiteSpace(text))
            return StatusCode(503, new { error = "ИИ недоступен, попробуйте позже" });

        // Заголовок — первой строкой markdown-заголовка, если модель его дала:
        // редактор иначе копирует заголовок из тела вручную.
        var (title, body) = SplitTitle(text);

        return Ok(new { title, bodyMarkdown = body });
    }

    /// <summary>Примеры-предложения к слову для карточки словаря.</summary>
    [HttpPost("word-examples")]
    public async Task<IActionResult> WordExamples(
        [FromBody] WordExamplesRequest request,
        CancellationToken ct = default)
    {
        var word = request?.Word?.Trim();

        if (string.IsNullOrWhiteSpace(word))
            return BadRequest(new { error = "Укажите слово" });

        if (word.Length > 100)
            return BadRequest(new { error = "Слово длиннее 100 символов" });

        var quotaError = await CheckQuotaAsync();
        if (quotaError != null) return quotaError;

        var count = Math.Clamp(request!.Count, 1, 10);
        var level = NormalizeLevel(request.Level);

        var prompt = BuildWordPrompt(word, request.Translation, level, count);

        var text = await _ai.GenerateForAdminAsync(
            prompt, "admin-word-examples", CurrentUserId, maxOutputTokens: 1024);

        if (string.IsNullOrWhiteSpace(text))
            return StatusCode(503, new { error = "ИИ недоступен, попробуйте позже" });

        var examples = ParseExamples(text);

        // Пустой разбор — это не «успех с пустым списком»: редактор нажал
        // кнопку и должен понять, что модель не справилась, а не решить, что
        // примеров у слова не бывает.
        if (examples.Count == 0)
            return StatusCode(503, new { error = "ИИ вернул ответ, из которого не удалось собрать примеры" });

        return Ok(new { examples });
    }

    /// <summary>Сколько вызовов осталось на сегодня — для подписи под кнопкой.</summary>
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var limit = _quota.AdminRequestLimit;
        var used = await _quota.GetAdminTodayRequestsAsync();

        return Ok(new
        {
            limit,
            used,
            remaining = Math.Max(0, limit - used),
            enabled = limit > 0,
        });
    }

    // ── Служебное ───────────────────────────────────────────────────────

    private string? CurrentUserId => User.FindFirstValue(ClaimTypes.NameIdentifier);

    /// <summary>
    /// null — можно идти к модели. Иначе готовый ответ об отказе.
    /// </summary>
    private async Task<IActionResult?> CheckQuotaAsync()
    {
        if (_quota.AdminRequestLimit <= 0)
        {
            // Не 429: лимит выключен конфигурацией, и «попробуйте завтра»
            // здесь было бы враньём — завтра то же самое.
            return StatusCode(503, new { error = "AI-ассистент выключен в конфигурации" });
        }

        if (!await _quota.IsWithinAdminQuotaAsync())
        {
            return StatusCode(429, new
            {
                error = $"Дневной лимит ассистента исчерпан ({_quota.AdminRequestLimit} вызовов). Обновится в 00:00 UTC.",
            });
        }

        return null;
    }

    private static string NormalizeLevel(string? level)
    {
        var value = level?.Trim().ToUpperInvariant() ?? "B1";
        return value is "A1" or "A2" or "B1" or "B2" or "C1" ? value : "B1";
    }

    private static string BuildArticlePrompt(string topic, string level, string? audience)
    {
        var audienceNote = string.IsNullOrWhiteSpace(audience)
            ? string.Empty
            : $"\nАудитория: {audience.Trim()}";

        return $"""
            Ты — методист и автор учебных материалов по английскому языку для
            русскоязычной платформы Lexicon.

            Напиши статью на русском языке на тему: «{topic}».
            Уровень читателя: {level} (CEFR).{audienceNote}

            Требования:
            - Первая строка — заголовок в формате `# Заголовок`, до 80 символов.
            - Далее 400–700 слов в markdown: подзаголовки `##`, абзацы, списки.
            - Английские примеры — с переводом в скобках.
            - Без воды, без «в современном мире», без вступлений на пол-экрана.
            - Не добавляй HTML-теги и не оборачивай ответ в тройные кавычки.
            - Пиши так, как пишешь для умного человека, который учит язык сам.
            """;
    }

    private static string BuildWordPrompt(string word, string? translation, string level, int count)
    {
        var translationNote = string.IsNullOrWhiteSpace(translation)
            ? string.Empty
            : $"\nПеревод по словарю: {translation.Trim()}";

        return $"""
            Ты — преподаватель английского. Дай {count} примера-предложения
            со словом «{word}» для ученика уровня {level} (CEFR).{translationNote}

            Формат ответа — строго одна строка на пример:
            English sentence. — Русский перевод.

            Требования:
            - Предложения короткие, естественные, из жизни, а не из учебника.
            - Слово «{word}» должно стоять в начальной форме или в форме,
              которую ученик узнает без отдельного объяснения.
            - Без нумерации, без markdown, без пояснений до или после списка.
            """;
    }

    /// <summary>
    /// Отделяет заголовок от тела. Модель может дать `# Заголовок` или вообще
    /// без него — тогда заголовок пуст, и редактор впишет свой.
    /// </summary>
    private static (string Title, string Body) SplitTitle(string markdown)
    {
        var lines = markdown.Replace("\r\n", "\n").Trim().Split('\n');

        if (lines.Length > 0 && lines[0].TrimStart().StartsWith("# ", StringComparison.Ordinal))
        {
            var title = lines[0].TrimStart()[2..].Trim();
            var body = string.Join('\n', lines.Skip(1)).TrimStart('\n');
            return (title, body);
        }

        return (string.Empty, markdown.Trim());
    }

    /// <summary>
    /// Разбор строк «English sentence. — Русский перевод.» в пары.
    ///
    /// Модель обещала формат, но обещание — не контракт: она может добавить
    /// нумерацию, маркеры списка или пояснительную строку перед списком.
    /// Строки без разделителя «—» отбрасываем: пример без перевода — это
    /// то, из-за чего ученик и открыл словарь.
    /// </summary>
    private static List<object> ParseExamples(string text)
    {
        var result = new List<object>();

        foreach (var raw in text.Replace("\r\n", "\n").Split('\n'))
        {
            var line = raw.Trim();

            // Снимаем нумерацию «1.», «2)» и маркеры «-», «*».
            line = System.Text.RegularExpressions.Regex.Replace(line, @"^(\d+[\.\)]\s*|[-*•]\s+)", string.Empty).Trim();

            if (line.Length == 0) continue;

            // Разделитель — тире с пробелами. Берём последнее вхождение:
            // в английском предложении тоже бывает дефис.
            var separator = line.LastIndexOf(" — ", StringComparison.Ordinal);
            if (separator < 0) separator = line.LastIndexOf(" – ", StringComparison.Ordinal);
            if (separator < 0) separator = line.LastIndexOf(" - ", StringComparison.Ordinal);

            if (separator <= 0) continue;

            var sentence = line[..separator].Trim();
            var translation = line[(separator + 3)..].Trim();

            if (sentence.Length == 0 || translation.Length == 0) continue;

            result.Add(new { Sentence = sentence, Translation = translation });
        }

        return result;
    }

    public sealed class ArticleDraftRequest
    {
        public string? Topic { get; set; }
        public string? Level { get; set; }
        public string? Audience { get; set; }
    }

    public sealed class WordExamplesRequest
    {
        public string? Word { get; set; }
        public string? Translation { get; set; }
        public string? Level { get; set; }
        public int Count { get; set; } = 3;
    }
}
