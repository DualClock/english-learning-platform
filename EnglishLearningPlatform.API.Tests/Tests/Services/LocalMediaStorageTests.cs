using EnglishLearningPlatform.API.Services.Media;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Абстракция медиа-хранилища.
///
/// Смысл интерфейса — переезд на S3 без правки вызывающего кода. Значит и
/// тестировать надо не «где файл лежит», а контракт: имя генерирует хранилище,
/// а не клиент; удаление идемпотентно; чужой файл не читается через путь.
/// </summary>
public class LocalMediaStorageTests : IDisposable
{
    private readonly string _root;

    public LocalMediaStorageTests()
    {
        // Не Path.GetTempPath(): на этой машине и TEMP, и TMPDIR указывают в
        // C:\Temp, куда процесс не может писать, и тест падает на создании
        // каталога вместо проверки логики. Берём каталог рядом с тестовой
        // сборкой — он гарантированно доступен на запись.
        var baseDir = AppContext.BaseDirectory;
        _root = Path.Combine(baseDir, "media-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);
    }

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch { /* тест уже прошёл */ }
    }

    private LocalMediaStorage Storage(string publicPrefix = "/media") =>
        new(_root, publicPrefix, NullLogger<LocalMediaStorage>.Instance);

    private static MemoryStream Bytes(params byte[] data) => new(data);

    [Fact]
    public async Task Сохраняет_файл_и_возвращает_публичный_адрес()
    {
        var storage = Storage();
        var data = new byte[] { 1, 2, 3, 4, 5 };

        var result = await storage.SaveAsync("word-images", Bytes(data), ".webp");

        Assert.StartsWith("/media/word-images/", result.PublicUrl);
        Assert.EndsWith(".webp", result.PublicUrl);
        Assert.Equal(data.Length, result.SizeBytes);

        var stored = await File.ReadAllBytesAsync(Path.Combine(_root, "word-images",
            Path.GetFileName(result.PublicUrl)));
        Assert.Equal(data, stored);
    }

    [Fact]
    public async Task Имя_генерирует_сервер_а_не_берёт_из_ввода()
    {
        // Клиентское имя — это и обход пути («../../appsettings.json»), и
        // подмена чужого файла. В публичном адресе его быть не должно.
        var storage = Storage();

        var result = await storage.SaveAsync("word-images", Bytes(1), ".png");

        var name = Path.GetFileName(result.PublicUrl);
        Assert.DoesNotContain("..", name);
        Assert.DoesNotContain("/", name);

        // GUID: 32 hex-символа. Строго проверяем формат, а не «похоже на случайное».
        Assert.Matches("^[0-9a-f]{32}\\.png$", name);
    }

    [Fact]
    public async Task Два_сохранения_дают_разные_имена()
    {
        // Одинаковое имя = вторая картинка затирает первую, и слово, которому
        // она принадлежит, показывает чужое изображение.
        var storage = Storage();

        var first = await storage.SaveAsync("words", Bytes(1), ".webp");
        var second = await storage.SaveAsync("words", Bytes(2), ".webp");

        Assert.NotEqual(first.PublicUrl, second.PublicUrl);
    }

    [Fact]
    public async Task Удаление_убирает_файл()
    {
        var storage = Storage();
        var result = await storage.SaveAsync("words", Bytes(1, 2), ".webp");

        var removed = await storage.DeleteAsync(result.PublicUrl);

        Assert.True(removed);
        Assert.False(File.Exists(Path.Combine(_root, "words", Path.GetFileName(result.PublicUrl))));
    }

    [Fact]
    public async Task Удаление_несуществующего_не_падает()
    {
        // Повторное удаление — нормальный сценарий: админ жмёт кнопку дважды,
        // или чистка запускается после ручного удаления файла.
        var storage = Storage();

        var removed = await storage.DeleteAsync("/media/words/нет-такого.webp");

        Assert.False(removed);
    }

    [Theory]
    [InlineData("/media/../../../appsettings.json")]
    [InlineData("/media/..%2F..%2Fappsettings.json")]
    [InlineData("../../../etc/passwd")]
    [InlineData("/media/words/../../secret.txt")]
    public async Task Обход_пути_не_удаляет_файл_вне_хранилища(string attack)
    {
        // Публичный адрес приходит из БД, но попасть туда он мог разными путями.
        // Хранилище обязано само отсечь выход за корень, а не надеяться на
        // вызывающий код.
        var outside = Path.Combine(_root, "..", "outside-" + Guid.NewGuid().ToString("N") + ".txt");
        await File.WriteAllTextAsync(outside, "secret");

        try
        {
            var storage = Storage();
            var removed = await storage.DeleteAsync(attack);
            Assert.False(removed);
            Assert.True(File.Exists(outside), "файл вне хранилища был удалён");
        }
        finally
        {
            File.Delete(outside);
        }
    }

    [Fact]
    public void Адрес_строится_с_заданным_префиксом()
    {
        // Префикс нужен, чтобы позже заменить /media на домен CDN, не меняя
        // строки в базе.
        var storage = Storage(publicPrefix: "https://cdn.example.com/media");

        Assert.Equal("https://cdn.example.com/media/words/abc.webp",
            storage.BuildPublicUrl("words", "abc.webp"));
    }

    [Theory]
    [InlineData("")]
    [InlineData(".exe")]
    [InlineData("webp")]
    [InlineData(".")]
    public async Task Неверное_расширение_отклоняется(string extension)
    {
        // Расширение попадает в имя файла на диске. Без точки и без контроля
        // получается либо имя без расширения, либо «..webp», которое ломает
        // проверку на обход пути.
        var storage = Storage();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            storage.SaveAsync("words", Bytes(1), extension));
    }

    [Fact]
    public async Task Пустой_поток_не_создаёт_файл()
    {
        var storage = Storage();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            storage.SaveAsync("words", new MemoryStream(Array.Empty<byte>()), ".webp"));

        var files = Directory.Exists(Path.Combine(_root, "words"))
            ? Directory.GetFiles(Path.Combine(_root, "words"))
            : Array.Empty<string>();

        Assert.Empty(files);
    }
}
