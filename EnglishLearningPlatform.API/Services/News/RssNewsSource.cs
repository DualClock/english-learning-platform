using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using EnglishLearningPlatform.API.Models;
using Ganss.Xss;

namespace EnglishLearningPlatform.API.Services.News;

/// <summary>
/// Источник новостей «News in Levels» — единственный, где уровень размечает
/// сам автор материала.
///
/// Фид — RSS 2.0 (application/rss+xml) от WordPress, и это задаёт три решения:
///
///  1. Разбор через <see cref="XDocument"/>, а не AngleSharp. AngleSharp — это
///     парсер HTML: он прощает битую разметку и молча «дорисовывает» узлы,
///     а нам нужны именно XML-элементы с учётом пространства имён (иначе
///     content:encoded не находится вовсе).
///  2. Код уровня живёт в заголовке: «No more horses – level 1». Номера 1/2/3 —
///     это A1/A2/B1 в шкале самого источника, а не наша оценка текста; B2 и C1
///     он не размечает, поэтому отсутствие уровня даёт null, а не догадку.
///  3. Полный текст лежит в content:encoded, в description — только обрезанный
///     анонс с подписью WordPress. Берём полный текст, анонс оставляем карточке.
///
/// Сеть и разбор разделены (<see cref="FetchAsync"/> против <see cref="Parse"/>):
/// тест разбирает сохранённый ответ фида, не ходя наружу, а сетевой сбой не
/// путается с ошибкой разбора.
/// </summary>
public class RssNewsSource : INewsSource
{
    public const string FeedUrl = "https://www.newsinlevels.com/feed/";

    /// <summary>Человекочитаемое имя: идёт в SourceName и в подпись карточки.</summary>
    private const string SourceDisplayName = "News in Levels";

    /// <summary>Сколько символов анонса помещается в NewsItem.Summary.</summary>
    private const int SummaryMaxLength = 1000;

    /// <summary>Сколько символов заголовка помещается в NewsItem.Title.</summary>
    private const int TitleMaxLength = 300;

    // WordPress дописывает в description абзац «The post … appeared first on …».
    // Это подпись генератора, а не анонс: без вырезания она занимает половину
    // карточки одинаковым текстом у всех новостей и обрезает сам анонс.
    private static readonly Regex WordPressBoilerplate = new(
        "<p>\\s*The post .*?appeared first on .*?</p>",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.Compiled);

    private static readonly Regex WhitespaceRun = new("\\s+", RegexOptions.Compiled);

    // Дата и время в начале описания: «26-10-2026 07:00 ». Формат фиксированный
    // (dd-MM-yyyy HH:mm), но допускаем и вариант с одной цифрой в месяце/дне:
    // источник может сменить формат, и жёсткая регулярка тогда тихо перестанет
    // срабатывать, вернув мусор в карточку.
    private static readonly Regex LeadingTimestamp = new(
        @"^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\s+\d{1,2}:\d{2}(:\d{2})?\s*",
        RegexOptions.Compiled);

    // Уровень в заголовке: «– level 1». Разделитель у источника — длинное тире,
    // но его легко сменят на дефис, поэтому ловим само «level N», а разделитель,
    // оставшийся висеть в конце, вычищаем вместе с ним.
    private static readonly Regex LevelSuffix = new(
        "\\s*[-–—:|]?\\s*level\\s*([1-9])\\s*$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// HtmlSanitizer потокобезопасен, пока не меняются списки разрешённых тегов,
    /// поэтому экземпляр один на процесс: новый на каждую запись фида — это
    /// лишняя сборка внутренних таблиц на десятке материалов в час.
    /// </summary>
    private static readonly HtmlSanitizer BodySanitizer = new();

    /// <summary>
    /// Санитайзер без разрешённых тегов — только для снятия разметки с анонса.
    /// KeepChildNodes обязателен: без него вместе с тегами вырежется и текст.
    /// </summary>
    private static readonly HtmlSanitizer TextOnlySanitizer = new(new HtmlSanitizerOptions
    {
        AllowedTags = new HashSet<string>(StringComparer.Ordinal),
        AllowedAttributes = new HashSet<string>(StringComparer.Ordinal)
    })
    {
        KeepChildNodes = true
    };

    /// <summary>
    /// Клиент без прокси: на машинах с локальным MITM-прокси запрос к
    /// newsinlevels падает по таймауту, хотя curl с --noproxy его отдаёт
    /// (та же история, что с Open Library в PopularBooksService).
    /// </summary>
    private static readonly HttpClient Http = new(new HttpClientHandler { UseProxy = false })
    {
        Timeout = TimeSpan.FromSeconds(20)
    };

    public string Name => SourceDisplayName;

    public async Task<IReadOnlyList<NewsFeedEntry>> FetchAsync(CancellationToken ct)
    {
        using var response = await Http.GetAsync(FeedUrl, ct);

        // Не-успех — исключение: фетчер ловит его по источнику и логирует.
        // Молча вернуть пустой список значило бы выдать блокировку WAF
        // за «новостей нет».
        response.EnsureSuccessStatusCode();

        // Читаем байты, а не строку: кодировка объявлена в XML, а в
        // Content-Type часто отсутствует.
        var bytes = await response.Content.ReadAsByteArrayAsync(ct);
        return Parse(Decode(bytes, response.Content.Headers.ContentType?.CharSet));
    }

    /// <summary>
    /// Разбор уже полученного XML. Публичный, чтобы тесты гоняли живой ответ
    /// фида из файла — без сети и без подмены HttpClient.
    ///
    /// Ничего не бросает на мусоре: источник может отдать HTML-страницу
    /// блокировки, пустой ответ или оборванный XML. Фоновая синхронизация в
    /// этом случае получает «новых записей нет» и продолжает работать.
    /// </summary>
    public IReadOnlyList<NewsFeedEntry> Parse(string xml)
    {
        var items = ReadItems(xml);

        var result = new List<NewsFeedEntry>(items.Count);
        foreach (var item in items)
        {
            var entry = MapItem(item);
            if (entry != null) result.Add(entry);
        }

        return result;
    }

    private static List<XElement> ReadItems(string xml)
    {
        if (string.IsNullOrWhiteSpace(xml)) return new List<XElement>();

        XDocument document;
        try
        {
            using var reader = new StringReader(xml);
            document = XDocument.Load(reader, LoadOptions.None);
        }
        catch (XmlException)
        {
            return new List<XElement>();
        }

        // Поиск по локальному имени, а не Element("channel").Elements("item"):
        // фид может стать Atom (entry) или обернуться в rdf:RDF, и тогда
        // жёсткий путь по структуре молча дал бы ноль записей.
        return document
            .Descendants()
            .Where(element => element.Name.LocalName is "item" or "entry")
            .ToList();
    }

    private static NewsFeedEntry? MapItem(XElement item)
    {
        var link = Value(item, "link");
        var rawTitle = Value(item, "title");

        // Без ссылки нет ExternalId, без заголовка нет карточки: такая запись
        // упала бы на NOT NULL уже после полного разбора фида.
        if (string.IsNullOrWhiteSpace(link) || string.IsNullOrWhiteSpace(rawTitle)) return null;

        if (!Uri.TryCreate(link, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;

        var (title, level) = SplitLevel(WebUtility.HtmlDecode(WhitespaceRun.Replace(rawTitle, " ").Trim()));

        var rawSummary = Value(item, "description") ?? string.Empty;
        var rawBody = Value(item, "encoded") ?? rawSummary;

        return new NewsFeedEntry(
            Title: Truncate(title, TitleMaxLength),
            Summary: BuildSummary(rawSummary, title),
            BodyHtml: BodySanitizer.Sanitize(rawBody),
            SourceName: SourceDisplayName,
            SourceUrl: uri.ToString(),
            // В фиде News in Levels картинок нет вовсе: иконки и видео живут на
            // странице материала, в RSS не попадают. Null — честнее заглушки.
            ImageUrl: null,
            Level: level,
            Topics: BuildTopics(item),
            PublishedAt: ReadPublishedAt(item));
    }

    /// <summary>
    /// Разделяет «Заголовок – level 2» на чистый заголовок и код уровня.
    ///
    /// Неизвестный номер даёт null, хотя суффикс всё равно снимается: «level 9»
    /// в заголовке — это шум генератора, а не уровень, и читателю он не нужен.
    /// </summary>
    private static (string Title, string? Level) SplitLevel(string title)
    {
        var match = LevelSuffix.Match(title);
        if (!match.Success) return (title, null);

        var cleaned = title[..match.Index].Trim();

        // Заголовок целиком состоял из «– level 1»: пустую строку вернуть
        // нельзя (NOT NULL и пустая карточка), поэтому отдаём текст как есть.
        if (cleaned.Length == 0) return (title, null);

        var level = match.Groups[1].Value switch
        {
            "1" => "A1",
            "2" => "A2",
            "3" => "B1",
            _ => null
        };

        return (cleaned, level);
    }

    /// <summary>
    /// Рубрики источника → наши ключи интересов.
    ///
    /// Через Normalize проходят все рубрики, после чего дубли схлопываются:
    /// «News» и «World news» — одна ветка, и две одинаковые темы в карточке
    /// читаются как сбой, а не как уточнение.
    ///
    /// Пустой список недопустим: запись без рубрик иначе провалилась бы в
    /// фильтр по интересам с пустым Topics и не попала ни в одну подборку.
    /// </summary>
    private static string[] BuildTopics(XElement item)
    {
        var topics = item.Elements()
            .Where(element => element.Name.LocalName == "category")
            .Select(element => Interests.Normalize(element.Value))
            .Where(Interests.IsValid)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        return topics.Length > 0 ? topics : new[] { "interesting" };
    }

    private static DateTime ReadPublishedAt(XElement item)
    {
        var raw = Value(item, "pubDate") ?? Value(item, "published") ?? Value(item, "updated");

        var parsed = DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out var value)
            ? value
            : DateTimeOffset.UtcNow;

        // Дата из будущего — обычно сбитые часы генератора фида. Новость с
        // PublishedAt в 2030 году навсегда осталась бы первой в ленте, поэтому
        // её приравниваем ко времени получения, как и отсутствующую дату.
        return parsed.UtcDateTime > DateTime.UtcNow.AddHours(1)
            ? DateTime.UtcNow
            : parsed.UtcDateTime;
    }

    /// <summary>
    /// Анонс для карточки: текст описания без разметки и без подписи WordPress.
    ///
    /// Теги снимаем тем же HtmlSanitizer, а не регэкспом: регэксп ломается на
    /// вложенности и съедает части текста, а санитайзер уже проверен на этих
    /// же данных в BodyHtml.
    ///
    /// Источник начинает описание с даты и времени («26-10-2026 07:00 An
    /// Australian politician…»). В карточке эта дата уже стоит отдельной
    /// строкой из pubDate, и без вырезания анонс начинается с мусора, а сам
    /// текст уезжает за границу двух строк clamp'а — человек видит цифры
    /// вместо содержания.
    /// </summary>
    private static string BuildSummary(string rawSummary, string title)
    {
        var withoutBoilerplate = WordPressBoilerplate.Replace(rawSummary, string.Empty);
        var text = WebUtility.HtmlDecode(TextOnlySanitizer.Sanitize(withoutBoilerplate));

        text = WhitespaceRun.Replace(text, " ").Trim();
        text = LeadingTimestamp.Replace(text, string.Empty).Trim();

        // Описание состояло из одной подписи генератора — карточка без анонса
        // всё равно должна иметь Summary (колонка NOT NULL).
        if (text.Length == 0) text = WebUtility.HtmlDecode(title);

        return Truncate(text, SummaryMaxLength);
    }

    private static string? Value(XElement parent, string localName) =>
        parent.Elements()
            .FirstOrDefault(element => element.Name.LocalName == localName)
            ?.Value
            .Trim();

    /// <summary>
    /// Обрезка по длине колонки без разрыва surrogate-пары: половина эмодзи
    /// на границе — это невалидная UTF-16-строка, и PostgreSQL отвергнет её
    /// на INSERT уже после успешного похода в сеть.
    /// </summary>
    private static string Truncate(string value, int maxLength)
    {
        if (value.Length <= maxLength) return value;

        var length = maxLength;
        if (char.IsHighSurrogate(value[length - 1])) length--;
        return value[..length].TrimEnd();
    }

    /// <summary>
    /// Кодировка из объявления XML или из заголовка ответа. UTF-8 совпадает с
    /// ASCII по всем служебным символам, поэтому объявление в нём читается так же.
    /// </summary>
    private static string Decode(byte[] bytes, string? charsetFromHeader)
    {
        var text = Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF');
        var declared = DeclaredEncoding(text) ?? charsetFromHeader;

        if (string.IsNullOrWhiteSpace(declared)) return text;
        if (declared.Equals("utf-8", StringComparison.OrdinalIgnoreCase)) return text;

        try
        {
            return Encoding.GetEncoding(declared).GetString(bytes).TrimStart('\uFEFF');
        }
        catch (ArgumentException)
        {
            // Неизвестное имя кодировки в заголовке — падать не из-за чего:
            // UTF-8 остаётся почти всегда верным ответом.
            return text;
        }
    }

    private static string? DeclaredEncoding(string xml)
    {
        var declarationEnd = xml.IndexOf("?>", StringComparison.Ordinal);
        if (!xml.StartsWith("<?xml", StringComparison.Ordinal) || declarationEnd < 0) return null;

        var declaration = xml[..declarationEnd];
        const string marker = "encoding=";
        var index = declaration.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (index < 0) return null;

        var rest = declaration[(index + marker.Length)..].TrimStart();
        if (rest.Length == 0 || (rest[0] != '"' && rest[0] != '\'')) return null;

        var quote = rest[0];
        var end = rest.IndexOf(quote, 1);
        return end < 0 ? null : rest[1..end];
    }
}
