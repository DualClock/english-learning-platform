using EnglishLearningPlatform.API.Services.Articles;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Рендер markdown в HTML.
///
/// Главное, что здесь держится: сырой HTML из markdown-текста НЕ проходит в
/// браузер. Markdig по спецификации пропускает его как есть, поэтому «храним
/// markdown — значит безопасно» неверно, и без санитайзера автор статьи может
/// исполнить скрипт в браузере читателя.
/// </summary>
public class MarkdownRendererTests
{
    private readonly MarkdownRenderer _renderer = new();

    [Fact]
    public void Абзац_превращается_в_тег_p()
    {
        Assert.Equal("<p>Hello world</p>\n", _renderer.Render("Hello world"));
    }

    [Fact]
    public void Заголовок_и_список_рендерятся()
    {
        var html = _renderer.Render("## Раздел\n\n- один\n- два");

        Assert.Contains("<h2", html);
        Assert.Contains("<ul>", html);
        Assert.Contains("<li>один</li>", html);
    }

    [Fact]
    public void Таблица_рендерится_расширением()
    {
        // Таблицы в markdown не входят в базовую спецификацию — их даёт
        // UseAdvancedExtensions. Без него автор увидит сырые «| a | b |».
        var html = _renderer.Render("| a | b |\n|---|---|\n| 1 | 2 |");

        Assert.Contains("<table>", html);
        Assert.Contains("<td>1</td>", html);
    }

    [Fact]
    public void Скрипт_из_markdown_вырезается()
    {
        var html = _renderer.Render("Текст\n\n<script>alert('xss')</script>");

        Assert.DoesNotContain("<script", html);
        Assert.DoesNotContain("alert", html);
        Assert.Contains("Текст", html);
    }

    [Fact]
    public void Скрипт_в_inline_html_вырезается()
    {
        var html = _renderer.Render("Привет <img src=x onerror=\"alert(1)\"> мир");

        Assert.DoesNotContain("onerror", html);
        Assert.DoesNotContain("alert", html);
    }

    [Fact]
    public void Javascript_ссылка_не_проходит()
    {
        // Классический обход: санитайзер с самодельным набором разрешений
        // обнуляет AllowedSchemes и пропускает это. Держим дефолтный инстанс.
        var html = _renderer.Render("[клик](javascript:alert(1))");

        Assert.DoesNotContain("javascript:", html);
    }

    [Fact]
    public void Iframe_не_проходит()
    {
        var html = _renderer.Render("<iframe src=\"https://evil.example\"></iframe>");

        Assert.DoesNotContain("<iframe", html);
    }

    [Fact]
    public void Обычная_картинка_и_ссылка_остаются()
    {
        var html = _renderer.Render("![кот](/media/cat.png)\n\n[сайт](https://example.com)");

        Assert.Contains("<img", html);
        Assert.Contains("/media/cat.png", html);
        Assert.Contains("href=\"https://example.com\"", html);
    }

    [Fact]
    public void Пустой_вход_даёт_пустую_строку()
    {
        // Не null: колонка BodyHtml NOT NULL, а null протёк бы в БД.
        Assert.Equal(string.Empty, _renderer.Render(null));
        Assert.Equal(string.Empty, _renderer.Render(""));
        Assert.Equal(string.Empty, _renderer.Render("   \n\t "));
    }

    [Fact]
    public void Анонс_из_тела_без_разметки()
    {
        var summary = _renderer.BuildSummary(null, "## Заголовок\n\nПервый абзац текста.");

        Assert.DoesNotContain("#", summary);
        Assert.DoesNotContain("<", summary);
        Assert.Contains("Первый абзац", summary);
    }

    [Fact]
    public void Явный_анонс_важнее_выведенного()
    {
        var summary = _renderer.BuildSummary("Мой анонс", "# Заголовок\n\nТело");

        Assert.Equal("Мой анонс", summary);
    }

    [Fact]
    public void Длинный_анонс_обрезается_по_границе_слова()
    {
        var longText = string.Join(" ", Enumerable.Repeat("слово", 200));

        var summary = _renderer.BuildSummary(null, longText, maxLength: 60);

        Assert.True(summary.Length <= 61, $"длина {summary.Length}");
        Assert.EndsWith("…", summary);

        // Граница слова: до многоточия не должно остаться куска слова.
        // Первая версия искала «слово…» — это ложное совпадение: строка
        // целиком из «слово слово», и такая подстрока находится РОВНО тогда,
        // когда обрезка пришлась на конец слова, то есть при правильном
        // поведении. Проверяем сам факт: последний символ — конец слова,
        // а не «слов» или «сло».
        var withoutEllipsis = summary.TrimEnd('…');
        Assert.True(
            withoutEllipsis.EndsWith("слово", StringComparison.Ordinal),
            $"обрезка не по границе слова: «{withoutEllipsis[^14..]}»");
    }

    [Fact]
    public void Анонс_из_пустого_тела_пуст()
    {
        Assert.Equal(string.Empty, _renderer.BuildSummary(null, null));
        Assert.Equal(string.Empty, _renderer.BuildSummary("   ", "   "));
    }

    [Fact]
    public void Анонс_не_содержит_разметки_из_код_блока()
    {
        // Угловые скобки внутри code-блока — часть содержания: в HTML они
        // приходят экранированными (&lt;div&gt;). После декодирования
        // получается настоящий тег, и без повторного снятия он уезжает в
        // анонс живым.
        var summary = _renderer.BuildSummary(null, "```\n<div>x</div>\n```\n\nПосле блока");

        Assert.DoesNotContain("<div>", summary);
        Assert.Contains("x", summary);
        Assert.Contains("После блока", summary);
    }
}
