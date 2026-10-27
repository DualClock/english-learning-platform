using Ganss.Xss;
using Markdig;

namespace EnglishLearningPlatform.API.Services.Articles;

/// <summary>
/// Превращает markdown в безопасный HTML для показа на сайте.
///
/// Две причины, почему это не делается на лету при каждом запросе страницы:
/// markdown-парсинг — самая дорогая часть отдачи статьи, а результат для одной
/// и той же строки не меняется. Поэтому HTML кэшируется в
/// <see cref="Models.Article.BodyHtml"/> при сохранении.
///
/// Санитизация обязательна и стоит ПОСЛЕ рендера, а не до: Markdig пропускает
/// сырой HTML из markdown-текста как есть (это часть спецификации), поэтому
/// «мы храним markdown, значит безопасно» — неверно. Автор может написать
/// &lt;script&gt; прямо в тексте, и без санитайзера он уедет в браузер читателя.
/// </summary>
public sealed class MarkdownRenderer
{
    /// <summary>
    /// Pipeline строится один раз: Markdig кэширует внутри себя разобранные
    /// структуры, и пересоздание на каждый вызов выбрасывает этот кэш.
    ///
    /// <c>DisableHtml()</c> не используется: панель админа вставляет картинки и
    /// таблицы, и часть статей уже написана с инлайн-HTML. Вместо вырезания
    /// HTML на входе его пропускаем, а санитайзер режет опасное на выходе —
    /// так автору не приходится удивляться, почему «&lt;br&gt;» съелся.
    /// </summary>
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseAdvancedExtensions()
        .UseSoftlineBreakAsHardlineBreak()
        .Build();

    /// <summary>
    /// Один экземпляр на процесс.
    ///
    /// Экземпляр по умолчанию, а не настроенный вручную: если передать только
    /// AllowedTags/AllowedAttributes, у HtmlSanitizer обнуляются AllowedSchemes,
    /// и <c>href="javascript:..."</c> начинает проходить. Это уже ловили в
    /// новостном парсере — дефолт безопаснее «умной» настройки.
    /// </summary>
    private static readonly HtmlSanitizer Sanitizer = new();

    /// <summary>
    /// Рендер и очистка. Возвращает HTML, готовый к вставке в страницу.
    /// </summary>
    public string Render(string? markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown)) return string.Empty;

        var html = Markdown.ToHtml(markdown, Pipeline);
        return Sanitizer.Sanitize(html);
    }

    /// <summary>
    /// Анонс для карточки в списке статей.
    ///
    /// Если у статьи явно задан Summary — берём его. Иначе выводим из тела:
    /// снять разметку и взять первые предложения. Без этого автор обязан
    /// заполнять два поля одним и тем же текстом, а списки выглядели бы
    /// карточками без описания.
    /// </summary>
    public string BuildSummary(string? explicitSummary, string? markdown, int maxLength = 240)
    {
        if (!string.IsNullOrWhiteSpace(explicitSummary))
            return Truncate(explicitSummary.Trim(), maxLength);

        if (string.IsNullOrWhiteSpace(markdown)) return string.Empty;

        // Рендерим и чистим, а не режем сырой markdown регэкспом: регэксп
        // оставляет в анонсе «##» и «[текст](url)», и в карточке это выглядит
        // как сломанная вёрстка.
        var text = Sanitizer.Sanitize(Markdown.ToHtml(markdown, Pipeline));

        // Порядок: снять теги → декодировать сущности → снять теги ЕЩЁ РАЗ.
        //
        // Первый проход убирает настоящую разметку (<p>, <pre>, <code>).
        // Второй нужен из-за code-блоков: внутри <code> разметка экранирована,
        // и текст «<div>x</div>» приходит как «&lt;div&gt;x&lt;/div&gt;».
        // Декодирование превращает сущности обратно в угловые скобки, и без
        // повторного прохода в анонс уезжает живой тег — в карточке это
        // выглядит как обрывок вёрстки, а не как показанный код.
        var plain = HtmlTag.Replace(text, " ");
        plain = System.Net.WebUtility.HtmlDecode(plain);
        plain = HtmlTag.Replace(plain, " ");
        plain = WhitespaceRun.Replace(plain, " ").Trim();

        return Truncate(plain, maxLength);
    }

    private static string Truncate(string text, int maxLength)
    {
        if (text.Length <= maxLength) return text;

        // Обрезка по границе слова: рвать посередине — это «читать в источни…».
        var cut = text.LastIndexOf(' ', Math.Min(maxLength, text.Length - 1));
        if (cut < maxLength / 2) cut = maxLength;

        var result = text[..cut].TrimEnd(' ', ',', ';', ':', '—', '-');

        // Суррогатная пара на границе даёт невалидную UTF-16-строку, и
        // PostgreSQL отвергнет её на INSERT.
        if (result.Length > 0 && char.IsHighSurrogate(result[^1]))
            result = result[..^1];

        return result + "…";
    }

    private static readonly System.Text.RegularExpressions.Regex HtmlTag =
        new("<[^>]+>", System.Text.RegularExpressions.RegexOptions.Compiled);

    private static readonly System.Text.RegularExpressions.Regex WhitespaceRun =
        new("\\s+", System.Text.RegularExpressions.RegexOptions.Compiled);
}
