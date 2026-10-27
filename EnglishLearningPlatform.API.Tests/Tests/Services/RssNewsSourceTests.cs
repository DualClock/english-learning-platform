using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services.News;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Парсер фида News in Levels. Тесты гоняют сохранённый живой ответ фида,
/// а не синтетику: формат RSS — это договорённость с чужим сервером, которая
/// ломается молча. Если источник начнёт отдавать уровень не в заголовке или
/// вложит скрипт в описание, мы узнаем об этом здесь, а не на проде.
///
/// Сеть в тестах запрещена: <see cref="RssNewsSource.Parse"/> разбирает строку,
/// поэтому загрузка файла — единственный внешний шаг, и он уже сделан.
/// </summary>
public class RssNewsSourceTests
{
    /// <summary>
    /// Фид лежит в репозитории рядом с остальными сидами и копируется в bin:
    /// тест читает ровно тот файл, который показывали при разборе источника.
    /// </summary>
    private static string FixtureXml => File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, "Data", "Seed", "news-fixture.xml"));

    private static IReadOnlyList<NewsFeedEntry> ParseFixture() =>
        new RssNewsSource().Parse(FixtureXml);

    /// <summary>
    /// Ключ дедупликации считает не парсер, а фетчер — через
    /// <see cref="NewsItemIdempotency.Hash"/>. Поэтому «ExternalId стабилен»
    /// проверяется на том же пути, каким его получит база: фид → ссылка → хэш.
    /// </summary>
    private static List<string> FixtureExternalIds() =>
        ParseFixture().Select(entry => NewsItemIdempotency.Hash(entry.SourceUrl)).ToList();

    [Fact]
    public void Парсер_разбирает_живой_фид()
    {
        // Пустой результат на настоящем фиде — самая частая поломка: namespace
        // RSS-тегов поменялся или источник переехал на Atom, а пайплайн
        // новостей при этом «работает» и просто не показывает ничего.
        Assert.NotEmpty(ParseFixture());
    }

    [Theory]
    [InlineData("No more horses in the streets of New York – level 1", "A1", "No more horses in the streets of New York")]
    [InlineData("Musk slows down internet for Ukraine – level 2", "A2", "Musk slows down internet for Ukraine")]
    [InlineData("To buy or to rent? – level 3", "B1", "To buy or to rent?")]
    public void Уровень_извлекается_из_заголовка(string title, string expectedLevel, string expectedTitle)
    {
        var entry = ParseSingle(Item(title, "https://www.newsinlevels.com/products/x/"));

        Assert.Equal(expectedLevel, entry.Level);
        Assert.Equal(expectedTitle, entry.Title);
    }

    [Fact]
    public void Уровень_из_живого_фида_мапится_в_CEFR()
    {
        var entries = ParseFixture();
        var levels = entries.Select(entry => entry.Level).Distinct().ToList();

        // Фид размечает только 1–3, то есть A1/A2/B1. Если в заголовках
        // остался «level N», суффикс не снялся; если появился B2 — парсер
        // выдумал уровень, которого источник не даёт.
        Assert.All(levels, level => Assert.Contains(level, new[] { "A1", "A2", "B1" }));
        Assert.DoesNotContain(entries, entry =>
            entry.Title.Contains("level", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Заголовок_без_уровня_остаётся_без_уровня()
    {
        var entry = ParseSingle(Item("Some untagged story", "https://www.newsinlevels.com/products/y/"));

        // null, а не B1 по умолчанию: выдать C1-текст первогодке хуже, чем не
        // показать новость в персональной выдаче вовсе.
        Assert.Null(entry.Level);
        Assert.Equal("Some untagged story", entry.Title);
    }

    [Fact]
    public void Неизвестный_номер_уровня_даёт_null_но_не_остаётся_в_заголовке()
    {
        // Источник может однажды ввести «level 4». Уровень мы не угадываем,
        // но шум в названии карточки оставлять незачем.
        var entry = ParseSingle(Item("Future story – level 9", "https://www.newsinlevels.com/products/future/"));

        Assert.Null(entry.Level);
        Assert.Equal("Future story", entry.Title);
    }

    [Fact]
    public void Скрипт_из_описания_вырезается_санитайзером()
    {
        var hostile = Item(
            "Hostile – level 1",
            "https://www.newsinlevels.com/products/hostile/",
            description: "<p>Safe text</p><script>alert('xss')</script><p onclick=\"steal()\">tail</p>");

        var entry = ParseSingle(hostile);

        Assert.DoesNotContain("script", entry.BodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("alert", entry.BodyHtml);
        Assert.DoesNotContain("onclick", entry.BodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Safe text", entry.BodyHtml);
    }

    [Fact]
    public void Скрипт_из_content_encoded_вырезается_санитайзером()
    {
        // WordPress кладёт полный текст в content:encoded. Парсер обязан брать
        // его и гонять через тот же санитайзер, иначе достаточно одного
        // неочищенного поля, чтобы XSS доехал до читателя.
        var hostile = Item(
            "Hostile body – level 2",
            "https://www.newsinlevels.com/products/hostile-body/",
            contentEncoded: "<p>Body</p><script>document.cookie</script>");

        var entry = ParseSingle(hostile);

        Assert.DoesNotContain("script", entry.BodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("document.cookie", entry.BodyHtml);
        Assert.Contains("Body", entry.BodyHtml);
    }

    [Fact]
    public void Полный_текст_берётся_из_content_encoded_а_не_из_обрезанного_описания()
    {
        var item = Item(
            "Full body – level 2",
            "https://www.newsinlevels.com/products/full-body/",
            description: "<p>Announce…</p>",
            contentEncoded: "<p>First paragraph.</p><p>Second paragraph, полный текст.</p>");

        var entry = ParseSingle(item);

        // В description у WordPress всегда обрезанный анонс с многоточием:
        // если брать тело оттуда, читатель видит огрызок материала.
        Assert.Contains("Second paragraph", entry.BodyHtml);
        Assert.DoesNotContain("Announce", entry.BodyHtml);
    }

    [Fact]
    public void BodyHtml_живого_фида_не_содержит_разметки_скриптов()
    {
        Assert.All(ParseFixture(), entry =>
        {
            Assert.False(string.IsNullOrWhiteSpace(entry.BodyHtml));
            Assert.DoesNotContain("<script", entry.BodyHtml, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public void ExternalId_стабилен_между_парсами()
    {
        // Повторная синхронизация сверяется по ExternalId. Нестабильный хэш
        // (DateTime, Random, порядок обхода) означал бы дубль каждой новости
        // на каждом проходе фетчера.
        Assert.Equal(FixtureExternalIds(), FixtureExternalIds());
    }

    [Fact]
    public void ExternalId_укладывается_в_колонку_и_уникален()
    {
        var ids = FixtureExternalIds();

        // MaxLength(64) в модели: более длинный ключ упадёт на INSERT, уже
        // после похода в сеть и разбора всего фида.
        Assert.All(ids, id => Assert.Equal(64, id.Length));
        Assert.All(ids, id => Assert.Matches("^[0-9a-f]{64}$", id));
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Fact]
    public void ExternalId_не_зависит_от_порядка_элементов_фида()
    {
        var single = new RssNewsSource().Parse(WrapItems(
            Item("Stable – level 1", "https://www.newsinlevels.com/products/stable/")));
        var reordered = new RssNewsSource().Parse(WrapItems(
            Item("Other – level 2", "https://www.newsinlevels.com/products/other/"),
            Item("Stable – level 1", "https://www.newsinlevels.com/products/stable/")));

        var stableId = NewsItemIdempotency.Hash(Assert.Single(single).SourceUrl);

        Assert.Contains(reordered, entry => NewsItemIdempotency.Hash(entry.SourceUrl) == stableId);
    }

    [Fact]
    public void Уровень_не_схлопывает_три_версии_одного_материала()
    {
        // Один материал приходит тремя записями (level 1/2/3) с разными
        // ссылками. Это три разные новости для читателя разного уровня;
        // дедупликация не должна схлопнуть их в одну строку.
        var ids = ParseFixture()
            .Where(entry => entry.Title.StartsWith("No more horses", StringComparison.Ordinal))
            .Select(entry => NewsItemIdempotency.Hash(entry.SourceUrl))
            .ToList();

        Assert.Equal(3, ids.Count);
        Assert.Equal(3, ids.Distinct().Count());
    }

    [Fact]
    public void Темы_нормализованы_в_известные_ключи()
    {
        var topics = ParseFixture().SelectMany(entry => entry.Topics).ToList();

        Assert.NotEmpty(topics);
        Assert.All(topics, topic => Assert.True(
            Interests.IsValid(topic),
            $"Тема «{topic}» не совпадёт ни с одним интересом пользователя — фильтр всегда будет пустым"));
    }

    [Fact]
    public void Темы_из_рубрик_склеены_без_дублей()
    {
        var entry = ParseSingle(Item(
            "Topics – level 1",
            "https://www.newsinlevels.com/products/topics/",
            categories: new[] { "News", "World news", "Interesting" }));

        // «News» и «World news» — одна ветка: в карточке такой дубль читается
        // как сбой, а фильтр по интересам всё равно один.
        Assert.Equal(new[] { "news", "interesting" }, entry.Topics);
    }

    [Fact]
    public void Запись_без_рубрик_получает_тему_по_умолчанию()
    {
        var entry = ParseSingle(Item("Uncategorised – level 1", "https://www.newsinlevels.com/products/uncat/"));

        // Пустой Topics сделал бы запись невидимой для фильтра по интересам,
        // хотя общая ветка справочника существует всегда.
        Assert.Equal(new[] { "interesting" }, entry.Topics);
    }

    [Fact]
    public void Дата_берётся_из_pubDate_в_UTC()
    {
        var item = Item("Dated – level 1", "https://www.newsinlevels.com/products/dated/",
            pubDate: "Tue, 27 Oct 2026 14:00:40 +0000");

        var entry = ParseSingle(item);

        Assert.Equal(new DateTime(2026, 10, 27, 14, 0, 40, DateTimeKind.Utc), entry.PublishedAt);
        Assert.Equal(DateTimeKind.Utc, entry.PublishedAt.Kind);
    }

    [Fact]
    public void Дата_со_смещением_часового_пояса_приводится_к_UTC()
    {
        var item = Item("Shifted – level 1", "https://www.newsinlevels.com/products/shifted/",
            pubDate: "Tue, 27 Oct 2026 17:00:40 +0300");

        // Местное время, сохранённое как UTC, уводит новость в ленте на три
        // часа — ровно на величину смещения источника.
        Assert.Equal(
            new DateTime(2026, 10, 27, 14, 0, 40, DateTimeKind.Utc),
            ParseSingle(item).PublishedAt);
    }

    [Fact]
    public void Ссылка_и_источник_переносятся_в_запись()
    {
        var entry = ParseFixture().First();

        Assert.StartsWith("https://www.newsinlevels.com/", entry.SourceUrl);
        Assert.False(string.IsNullOrWhiteSpace(entry.SourceName));
        Assert.False(string.IsNullOrWhiteSpace(entry.Summary));
    }

    [Fact]
    public void Сводка_очищена_от_html_хвоста_фида()
    {
        // News in Levels дописывает в description служебный абзац «The post …
        // appeared first on …». Его нельзя показывать как анонс карточки: он
        // одинаковый у всех новостей и вытесняет сам текст.
        Assert.All(ParseFixture(), entry =>
        {
            Assert.DoesNotContain("<", entry.Summary);
            Assert.DoesNotContain("appeared first on", entry.Summary, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public void Сводка_укладывается_в_колонку()
    {
        var longText = "<p>" + string.Join(" ", Enumerable.Repeat("word", 5000)) + "</p>";

        // MaxLength(1000): обрезка длинного анонса — часть парсера, а не
        // сюрприз на SaveChanges, когда до базы уже дошёл весь фид.
        Assert.True(ParseSingle(Item(
            "Long – level 1",
            "https://www.newsinlevels.com/products/long/",
            description: longText)).Summary.Length <= 1000);
    }

    [Fact]
    public void Сводка_не_начинается_с_даты()
    {
        // Источник начинает описание с «26-10-2026 07:00 ». В карточке дата уже
        // стоит отдельной строкой из pubDate, поэтому в анонсе она — мусор,
        // съедающий место в двух строках clamp'а.
        var entry = ParseSingle(Item(
            "Horses – level 1",
            "https://www.newsinlevels.com/products/horses/",
            description: "<p>26-10-2026 07:00 New York wants to ban horse carriages.</p>"));

        Assert.StartsWith("New York", entry.Summary, StringComparison.Ordinal);
        Assert.DoesNotContain("2026", entry.Summary, StringComparison.Ordinal);
    }

    [Fact]
    public void Сводка_без_даты_не_меняется()
    {
        // Обратная сторона: если даты в начале нет, текст обязан остаться
        // как есть — иначе регулярка съела бы первые цифры содержания
        // («100 people…»).
        var entry = ParseSingle(Item(
            "Numbers – level 1",
            "https://www.newsinlevels.com/products/numbers/",
            description: "<p>100 people came to the square.</p>"));

        Assert.StartsWith("100 people", entry.Summary, StringComparison.Ordinal);
    }

    [Fact]
    public void Заголовок_укладывается_в_колонку()
    {
        var longTitle = string.Join(" ", Enumerable.Repeat("word", 200)) + " – level 1";

        // MaxLength(300) у NewsItem.Title.
        Assert.True(ParseSingle(Item(
            longTitle,
            "https://www.newsinlevels.com/products/long-title/")).Title.Length <= 300);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not xml at all")]
    [InlineData("<rss><channel><item><title>Broken")]
    [InlineData("<html><body>Страница блокировки</body></html>")]
    public void Битый_XML_даёт_пустой_список_а_не_исключение(string xml)
    {
        // Источник может отдать HTML-заглушку WAF или оборванный ответ. Фоновая
        // синхронизация не должна падать из-за этого: пустой список — сигнал
        // «новых данных нет», исключение — упавший цикл и алерт.
        Assert.Empty(new RssNewsSource().Parse(xml));
    }

    [Fact]
    public void Запись_без_заголовка_или_ссылки_пропускается()
    {
        var incomplete = WrapItems(
            Item(title: null, link: "https://www.newsinlevels.com/products/no-title/"),
            Item(title: "No link – level 1", link: null),
            Item("Good – level 1", "https://www.newsinlevels.com/products/good/"));

        // Без ссылки нет ключа дедупликации, без заголовка нет карточки; обе
        // записи упали бы на NOT NULL в базе уже после синхронизации.
        var entry = Assert.Single(new RssNewsSource().Parse(incomplete));
        Assert.Equal("Good", entry.Title);
    }

    [Fact]
    public void Ссылка_не_http_не_проходит()
    {
        var entries = new RssNewsSource().Parse(WrapItems(
            Item("Js link – level 1", "javascript:alert(1)"),
            Item("Good – level 1", "https://www.newsinlevels.com/products/good2/")));

        // SourceUrl отдаётся фронту отдельным полем и попадает в href:
        // javascript:-ссылку из фида нельзя даже сохранять, иначе санитайзер
        // тела останется единственной защитой.
        Assert.StartsWith("https://", Assert.Single(entries).SourceUrl);
    }

    private static NewsFeedEntry ParseSingle(string itemXml) =>
        Assert.Single(new RssNewsSource().Parse(WrapItems(itemXml)));

    /// <summary>
    /// Один item в том виде, в каком его собирает WordPress. Собирается строка,
    /// а не XDocument: тест проверяет парсер на сыром тексте, как в проде.
    /// </summary>
    private static string Item(
        string? title,
        string? link,
        string? description = null,
        string? contentEncoded = null,
        IEnumerable<string>? categories = null,
        string pubDate = "Tue, 27 Oct 2026 12:00:00 +0000")
    {
        var xml = new System.Text.StringBuilder();
        xml.Append("<item>");
        if (title != null) xml.Append($"<title>{Escape(title)}</title>");
        if (link != null) xml.Append($"<link>{Escape(link)}</link>");
        xml.Append($"<pubDate>{Escape(pubDate)}</pubDate>");
        foreach (var category in categories ?? Array.Empty<string>())
        {
            xml.Append($"<category><![CDATA[{category}]]></category>");
        }

        xml.Append($"<description><![CDATA[{description ?? "<p>Summary text</p>"}]]></description>");
        if (contentEncoded != null)
        {
            xml.Append($"<content:encoded><![CDATA[{contentEncoded}]]></content:encoded>");
        }
        xml.Append("</item>");
        return xml.ToString();
    }

    private static string WrapItems(params string[] items) =>
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
        "<rss version=\"2.0\" xmlns:content=\"http://purl.org/rss/1.0/modules/content/\">" +
        "<channel><title>Test</title>" + string.Concat(items) + "</channel></rss>";

    private static string Escape(string value) =>
        value.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");
}
