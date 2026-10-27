using EnglishLearningPlatform.API.Services.Import;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Разбор CSV и JSON для массового импорта слов.
///
/// Импорт — самая опасная операция админки: одна ошибка в разборе заливает
/// сотни битых строк, и чистить их руками. Поэтому здесь проверяется не
/// «счастливый путь», а всё, что ломает файл: кавычки, запятые внутри полей,
/// BOM из Excel, разный регистр заголовков, дубли и пустые строки.
/// </summary>
public class WordImportParserTests
{
    private readonly WordImportParser _parser = new();

    [Fact]
    public void CSV_с_заголовками_разбирается()
    {
        var csv = "English,Translation,Transcription,Example\napple,яблоко,ˈæp.əl,An apple a day\n";

        var result = _parser.ParseCsv(csv);

        Assert.Single(result.Rows);
        Assert.Equal("apple", result.Rows[0].English);
        Assert.Equal("яблоко", result.Rows[0].Translation);
        Assert.Equal("ˈæp.əl", result.Rows[0].Transcription);
        Assert.Equal("An apple a day", result.Rows[0].Example);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void Запятая_в_кавычках_не_делит_поле()
    {
        // Самая частая ошибка самодельного парсера: split(',') по всей строке.
        // Пример с запятой внутри кавычек — нормальный перевод из словаря.
        var csv = "English,Translation,Example\nrun,бежать,\"To run, to walk\"\n";

        var result = _parser.ParseCsv(csv);

        Assert.Equal("To run, to walk", result.Rows[0].Example);
    }

    [Fact]
    public void Экранированная_кавычка_восстанавливается()
    {
        // В CSV двойная кавычка внутри поля пишется как "" — иначе файл,
        // сделанный Excel, читается с обрезанным текстом.
        var csv = "English,Translation\nsee,\"видеть (\"\"to see\"\")\"\n";

        var result = _parser.ParseCsv(csv);

        Assert.Equal("видеть (\"to see\")", result.Rows[0].Translation);
    }

    [Fact]
    public void Перенос_строки_внутри_поля_не_рвёт_строку()
    {
        var csv = "English,Translation,Example\nword,слово,\"Первая строка\nВторая строка\"\n";

        var result = _parser.ParseCsv(csv);

        Assert.Single(result.Rows);
        Assert.Contains("Вторая строка", result.Rows[0].Example);
    }

    [Fact]
    public void BOM_от_Excel_не_портит_первый_заголовок()
    {
        // Excel сохраняет «\uFEFFCSV в UTF-8». Без снятия BOM первая колонка
        // называется «\uFEFFEnglish», и парсер не находит её по имени —
        // весь файл читается как ошибка.
        var csv = "\uFEFFEnglish,Translation\napple,яблоко\n";

        var result = _parser.ParseCsv(csv);

        Assert.Empty(result.Errors);
        Assert.Equal("apple", result.Rows[0].English);
    }

    [Theory]
    [InlineData("english,translation")]
    [InlineData("ENGLISH,TRANSLATION")]
    [InlineData("English , Translation ")]
    public void Регистр_и_пробелы_в_заголовках_не_важны(string header)
    {
        var csv = header + "\napple,яблоко\n";

        var result = _parser.ParseCsv(csv);

        Assert.Equal("apple", result.Rows[0].English);
    }

    [Fact]
    public void Без_заголовков_работает_позиционно()
    {
        // Файл из блокнота, без шапки: две колонки — слово и перевод.
        var csv = "apple,яблоко\nrun,бежать\n";

        var result = _parser.ParseCsv(csv);

        Assert.Equal(2, result.Rows.Count);
        Assert.Equal("apple", result.Rows[0].English);
        Assert.Equal("бежать", result.Rows[1].Translation);
    }

    [Fact]
    public void Пустые_строки_пропускаются()
    {
        var csv = "English,Translation\n\napple,яблоко\n\n\nrun,бежать\n\n";

        var result = _parser.ParseCsv(csv);

        Assert.Equal(2, result.Rows.Count);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void Дубли_внутри_файла_схлопываются_с_предупреждением()
    {
        // Иначе импорт упадёт на уникальном индексе в середине транзакции,
        // и админ не поймёт, какая именно строка виновата.
        var csv = "English,Translation\napple,яблоко\nAPPLE,яблочко\n";

        var result = _parser.ParseCsv(csv);

        Assert.Single(result.Rows);
        Assert.NotEmpty(result.Warnings);
        Assert.Contains("apple", result.Warnings[0].Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Строка_без_перевода_попадает_в_ошибки_а_не_в_данные()
    {
        var csv = "English,Translation\napple,\nrun,бежать\n";

        var result = _parser.ParseCsv(csv);

        Assert.Single(result.Rows);
        Assert.Single(result.Errors);
        Assert.Equal(2, result.Errors[0].Line); // шапка — строка 1
    }

    [Fact]
    public void Пустой_файл_разбирается_без_падения()
    {
        var result = _parser.ParseCsv("");

        Assert.Empty(result.Rows);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void JSON_массив_разбирается()
    {
        var json = """
            [{"english":"apple","translation":"яблоко","example":"An apple"},
             {"english":"run","translation":"бежать"}]
            """;

        var result = _parser.ParseJson(json);

        Assert.Equal(2, result.Rows.Count);
        Assert.Equal("apple", result.Rows[0].English);
        Assert.Equal("An apple", result.Rows[0].Example);
    }

    [Fact]
    public void JSON_с_объектом_и_массивом_внутри_разбирается()
    {
        // Экспорт из других сервисов часто оборачивает список в объект.
        var json = """{"words":[{"english":"apple","translation":"яблоко"}]}""";

        var result = _parser.ParseJson(json);

        Assert.Single(result.Rows);
    }

    [Fact]
    public void Битый_JSON_даёт_ошибку_а_не_исключение()
    {
        var result = _parser.ParseJson("[{\"english\": ]");

        Assert.Empty(result.Rows);
        Assert.NotEmpty(result.Errors);
    }

    [Fact]
    public void JSON_без_обязательных_полей_отклоняется()
    {
        var json = "[{\"english\":\"apple\"},{\"translation\":\"яблоко\"}]";

        var result = _parser.ParseJson(json);

        Assert.Empty(result.Rows);
        Assert.Equal(2, result.Errors.Count);
    }

    [Fact]
    public void Очень_длинное_слово_отклоняется_с_понятной_ошибкой()
    {
        // Колонка English — MaxLength(100). Отказ на этапе разбора лучше,
        // чем DbUpdateException на середине импорта.
        var csv = "English,Translation\n" + new string('a', 150) + ",слово\n";

        var result = _parser.ParseCsv(csv);

        Assert.Empty(result.Rows);
        Assert.Single(result.Errors);
        Assert.Contains("100", result.Errors[0].Message);
    }

    [Fact]
    public void Слово_обрезается_по_краям()
    {
        var csv = "English,Translation\n  apple  ,  яблоко  \n";

        var result = _parser.ParseCsv(csv);

        Assert.Equal("apple", result.Rows[0].English);
        Assert.Equal("яблоко", result.Rows[0].Translation);
    }
}
