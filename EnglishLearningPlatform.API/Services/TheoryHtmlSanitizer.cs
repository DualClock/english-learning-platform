using Ganss.Xss;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Очистка HTML теории грамматики. Фронтенд вставляет TheoryHtml через
/// dangerouslySetInnerHTML, поэтому API обязан отдавать только безопасную
/// разметку: без script/style, обработчиков событий и javascript:-ссылок.
/// </summary>
public static class TheoryHtmlSanitizer
{
    // HtmlSanitizer потокобезопасен, если не менять списки разрешённых тегов
    private static readonly HtmlSanitizer Sanitizer = new();

    public static string? Sanitize(string? html) =>
        string.IsNullOrWhiteSpace(html) ? html : Sanitizer.Sanitize(html);
}
