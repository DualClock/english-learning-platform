using System.Text;
using System.Text.Json;

namespace EnglishLearningPlatform.API.Services.Import;

/// <summary>Одна строка, готовая к записи в CategoryWord.</summary>
public sealed record WordImportRow(
    string English,
    string Translation,
    string? Transcription,
    string? Example);

/// <summary>Ошибка разбора с номером строки файла — админ должен найти её глазами.</summary>
public sealed record WordImportError(int Line, string Message);

/// <summary>Предупреждение: строка принята, но что-то в ней поправлено или пропущено.</summary>
public sealed record WordImportWarning(int Line, string Message);

public sealed record WordImportResult(
    IReadOnlyList<WordImportRow> Rows,
    IReadOnlyList<WordImportError> Errors,
    IReadOnlyList<WordImportWarning> Warnings);

/// <summary>
/// Разбор CSV и JSON для массового импорта слов.
///
/// CSV разбирается вручную, а не через string.Split(','), потому что перевод
/// из настоящего словаря регулярно содержит запятую внутри кавычек и двойную
/// кавычку внутри поля. Наивный разбор режет такие строки посередине и
/// заливает в базу обрезанные переводы — их потом ищут руками по всему словарю.
///
/// Разбор не бросает исключений на плохих данных: файл от человека, и его
/// ошибки — это нормальный поток управления. Исключение здесь означало бы
/// «импорт не состоялся целиком» вместо «строка 17 неправильная».
/// </summary>
public sealed class WordImportParser
{
    // Лимиты колонок совпадают с моделями: отказ на разборе понятнее, чем
    // DbUpdateException на середине транзакции, когда уже записано 200 строк.
    private const int MaxEnglish = 100;
    private const int MaxTranslation = 200;
    private const int MaxTranscription = 100;
    private const int MaxExample = 500;

    /// <summary>
    /// Сколько ошибок показывать. Файл на 5000 строк с шапкой не тем полем
    /// даст 5000 ошибок, и ответ на 2 МБ бесполезен — админу нужно понять
    /// причину, а не прочитать весь файл в чате.
    /// </summary>
    private const int MaxReportedErrors = 50;

    private static readonly string[] EnglishHeaders = { "english", "word", "слово", "английский" };
    private static readonly string[] TranslationHeaders = { "translation", "перевод", "russian", "русский" };
    private static readonly string[] TranscriptionHeaders = { "transcription", "транскрипция", "ipa" };
    private static readonly string[] ExampleHeaders = { "example", "пример", "sentence", "предложение" };

    public WordImportResult ParseCsv(string? content)
    {
        var rows = new List<WordImportRow>();
        var errors = new List<WordImportError>();
        var warnings = new List<WordImportWarning>();

        if (string.IsNullOrWhiteSpace(content))
            return new WordImportResult(rows, errors, warnings);

        // Excel сохраняет «\uFEFFCSV». Без снятия BOM первый заголовок
        // называется «\uFEFFEnglish» и не находится по имени.
        var text = content.TrimStart('\uFEFF');

        var records = SplitCsvRecords(text);
        if (records.Count == 0) return new WordImportResult(rows, errors, warnings);

        var first = records[0];
        var map = DetectHeader(first.Fields);

        var startIndex = map.HasHeader ? 1 : 0;

        // Без шапки — позиционно: слово, перевод, [транскрипция], [пример].
        if (!map.HasHeader)
        {
            map = new HeaderMap(true, 0, 1, 2, 3);
        }

        var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var reported = 0;

        for (var i = startIndex; i < records.Count; i++)
        {
            var record = records[i];

            // Полностью пустая строка — не ошибка: так выглядят файлы после
            // Excel, который любит оставлять хвост из запятых.
            if (record.Fields.All(string.IsNullOrWhiteSpace)) continue;

            if (errors.Count >= MaxReportedErrors)
            {
                warnings.Add(new WordImportWarning(record.Line, "Дальнейшие ошибки не показаны"));
                break;
            }

            var english = Field(record, map.English);
            var translation = Field(record, map.Translation);

            if (string.IsNullOrWhiteSpace(english) || string.IsNullOrWhiteSpace(translation))
            {
                errors.Add(new WordImportError(record.Line, "Нужны английское слово и перевод"));
                reported++;
                continue;
            }

            var lengthError = CheckLengths(english, translation, Field(record, map.Transcription), Field(record, map.Example));
            if (lengthError != null)
            {
                errors.Add(new WordImportError(record.Line, lengthError));
                reported++;
                continue;
            }

            // Дубль внутри файла: пропускаем с предупреждением, а не роняем
            // импорт на уникальном индексе в середине транзакции.
            if (seen.TryGetValue(english, out var firstLine))
            {
                warnings.Add(new WordImportWarning(record.Line,
                    $"«{english}» уже был в строке {firstLine} — строка пропущена"));
                continue;
            }

            seen[english] = record.Line;

            rows.Add(new WordImportRow(
                english,
                translation,
                NullIfEmpty(Field(record, map.Transcription)),
                NullIfEmpty(Field(record, map.Example))));
        }

        return new WordImportResult(rows, errors, warnings);
    }

    public WordImportResult ParseJson(string? content)
    {
        var rows = new List<WordImportRow>();
        var errors = new List<WordImportError>();
        var warnings = new List<WordImportWarning>();

        if (string.IsNullOrWhiteSpace(content))
            return new WordImportResult(rows, errors, warnings);

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(content.TrimStart('\uFEFF'));
        }
        catch (JsonException ex)
        {
            // Номер строки из JsonException бесполезен человеку (это позиция
            // байта), поэтому даём общий текст: файл — не валидный JSON.
            errors.Add(new WordImportError(0, $"Файл не является корректным JSON: {ex.Message}"));
            return new WordImportResult(rows, errors, warnings);
        }

        using (document)
        {
            var array = FindArray(document.RootElement);
            if (array == null)
            {
                errors.Add(new WordImportError(0,
                    "Не найден массив слов. Ожидается [ {...}, {...} ] или { \"words\": [ ... ] }"));
                return new WordImportResult(rows, errors, warnings);
            }

            var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var index = 0;

            foreach (var element in array.Value.EnumerateArray())
            {
                index++;

                if (element.ValueKind != JsonValueKind.Object)
                {
                    errors.Add(new WordImportError(index, "Элемент не является объектом"));
                    continue;
                }

                var english = StringProperty(element, EnglishHeaders);
                var translation = StringProperty(element, TranslationHeaders);

                if (string.IsNullOrWhiteSpace(english) || string.IsNullOrWhiteSpace(translation))
                {
                    errors.Add(new WordImportError(index, "Нужны поля english и translation"));
                    continue;
                }

                var transcription = StringProperty(element, TranscriptionHeaders);
                var example = StringProperty(element, ExampleHeaders);

                var lengthError = CheckLengths(english, translation, transcription, example);
                if (lengthError != null)
                {
                    errors.Add(new WordImportError(index, lengthError));
                    continue;
                }

                if (seen.TryGetValue(english, out var firstIndex))
                {
                    warnings.Add(new WordImportWarning(index,
                        $"«{english}» уже был в элементе {firstIndex} — пропущен"));
                    continue;
                }

                seen[english] = index;

                rows.Add(new WordImportRow(
                    english, translation, NullIfEmpty(transcription), NullIfEmpty(example)));
            }
        }

        return new WordImportResult(rows, errors, warnings);
    }

    // ── CSV ─────────────────────────────────────────────────────────────

    private sealed record CsvRecord(int Line, List<string> Fields);

    private sealed record HeaderMap(
        bool HasHeader, int English, int Translation, int Transcription, int Example);

    /// <summary>
    /// Разбор CSV по RFC 4180: кавычки, "" как экранированная кавычка,
    /// переносы строк внутри поля.
    ///
    /// Номер строки считается по фактическим переводам строки в файле:
    /// поле с переносом занимает несколько строк, и админ ищет проблему
    /// в блокноте по реальному номеру, а не по индексу записи.
    /// </summary>
    private static List<CsvRecord> SplitCsvRecords(string text)
    {
        var records = new List<CsvRecord>();
        var fields = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;
        var line = 1;
        var recordStartLine = 1;

        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];

            if (inQuotes)
            {
                if (ch == '"')
                {
                    // "" внутри кавычек — это одна литеральная кавычка.
                    if (i + 1 < text.Length && text[i + 1] == '"')
                    {
                        field.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    if (ch == '\n') line++;
                    field.Append(ch);
                }

                continue;
            }

            switch (ch)
            {
                case '"':
                    inQuotes = true;
                    break;

                case ',':
                    fields.Add(field.ToString());
                    field.Clear();
                    break;

                case '\r':
                    // \r\n считаем одним переводом строки — иначе все номера
                    // после первого окажутся на единицу больше.
                    if (i + 1 < text.Length && text[i + 1] == '\n') i++;
                    goto case '\n';

                case '\n':
                    fields.Add(field.ToString());
                    field.Clear();
                    records.Add(new CsvRecord(recordStartLine, new List<string>(fields)));
                    fields.Clear();
                    line++;
                    recordStartLine = line;
                    break;

                default:
                    field.Append(ch);
                    break;
            }
        }

        // Последняя строка без завершающего перевода.
        if (field.Length > 0 || fields.Count > 0)
        {
            fields.Add(field.ToString());
            records.Add(new CsvRecord(recordStartLine, new List<string>(fields)));
        }

        return records;
    }

    private static HeaderMap DetectHeader(List<string> fields)
    {
        var normalized = fields.Select(NormalizeHeader).ToList();

        var english = normalized.FindIndex(h => EnglishHeaders.Contains(h));
        var translation = normalized.FindIndex(h => TranslationHeaders.Contains(h));

        // Шапка настоящая только если найдены оба обязательных столбца:
        // файл без шапки начнётся со слова «apple», и ни одно имя не совпадёт.
        if (english < 0 || translation < 0) return new HeaderMap(false, 0, 1, 2, 3);

        var transcription = normalized.FindIndex(h => TranscriptionHeaders.Contains(h));
        var example = normalized.FindIndex(h => ExampleHeaders.Contains(h));

        return new HeaderMap(
            true,
            english,
            translation,
            transcription >= 0 ? transcription : -1,
            example >= 0 ? example : -1);
    }

    private static string NormalizeHeader(string value) =>
        value.Trim().Trim('"').ToLowerInvariant().Replace(" ", string.Empty);

    private static string Field(CsvRecord record, int index) =>
        index >= 0 && index < record.Fields.Count ? record.Fields[index].Trim() : string.Empty;

    // ── JSON ────────────────────────────────────────────────────────────

    /// <summary>
    /// Ищем массив слов: либо корень — массив, либо первое свойство-массив
    /// объекта. Экспорт из чужих сервисов часто оборачивает список в объект
    /// с метаданными, и требовать «только массив» значит отвергать рабочие файлы.
    /// </summary>
    private static JsonElement? FindArray(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array) return root;

        if (root.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in root.EnumerateObject())
            {
                if (property.Value.ValueKind == JsonValueKind.Array) return property.Value;
            }
        }

        return null;
    }

    private static string? StringProperty(JsonElement element, string[] names)
    {
        foreach (var property in element.EnumerateObject())
        {
            var key = property.Name.Trim().ToLowerInvariant().Replace(" ", string.Empty);
            if (!names.Contains(key)) continue;

            return property.Value.ValueKind switch
            {
                JsonValueKind.String => property.Value.GetString()?.Trim(),
                JsonValueKind.Number => property.Value.GetRawText(),
                _ => null,
            };
        }

        return null;
    }

    // ── Общее ───────────────────────────────────────────────────────────

    private static string? CheckLengths(string english, string translation, string? transcription, string? example)
    {
        if (english.Length > MaxEnglish)
            return $"Слово длиннее {MaxEnglish} символов";

        if (translation.Length > MaxTranslation)
            return $"Перевод длиннее {MaxTranslation} символов";

        if (transcription != null && transcription.Length > MaxTranscription)
            return $"Транскрипция длиннее {MaxTranscription} символов";

        if (example != null && example.Length > MaxExample)
            return $"Пример длиннее {MaxExample} символов";

        return null;
    }

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
