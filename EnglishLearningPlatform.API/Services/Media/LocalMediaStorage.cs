using System.Text.RegularExpressions;

namespace EnglishLearningPlatform.API.Services.Media;

/// <summary>
/// Локальное хранилище: файлы на диске, адреса — относительные пути.
///
/// Относительный адрес, а не абсолютный: платформа работает и на localhost,
/// и по внешнему адресу, и с телефона в той же сети. Абсолютный адрес,
/// собранный из base-url запроса, ломается при каждом из этих случаев —
/// эта проблема уже ловилась на гостевом чтении.
/// </summary>
public sealed class LocalMediaStorage : IMediaStorage
{
    /// <summary>
    /// Расширение — точка + 1..8 букв/цифр, из белого списка.
    ///
    /// Свободное расширение попадает в имя файла на диске, а значит участвует
    /// в проверке на обход пути. «.» или «..webp» ломают нормализацию, поэтому
    /// формат задан явно.
    ///
    /// Белый список, а не только формат: регулярка «^\.\w+$» пропускает .exe,
    /// .dll, .aspx — и файл с таким именем в publичной папке статики
    /// исполняется веб-сервером. Медиа-хранилище хранит картинки и аудио,
    /// остальному здесь не место.
    /// </summary>
    private static readonly Regex SafeExtension = new(
        "^\\.(webp|png|jpe?g|gif|svg|avif|mp3|ogg|wav|m4a|webm|mp4)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>Папка — только буквы, цифры и дефис. Без «..» и слешей.</summary>
    private static readonly Regex SafeFolder = new("^[a-z0-9][a-z0-9-]{0,63}$", RegexOptions.Compiled);

    private readonly string _rootPath;
    private readonly string _publicPrefix;
    private readonly ILogger<LocalMediaStorage> _logger;

    public LocalMediaStorage(string rootPath, string publicPrefix, ILogger<LocalMediaStorage> logger)
    {
        _rootPath = Path.GetFullPath(rootPath);
        _publicPrefix = publicPrefix.TrimEnd('/');
        _logger = logger;
    }

    public string BuildPublicUrl(string folder, string fileName) =>
        $"{_publicPrefix}/{folder}/{fileName}";

    public async Task<MediaFile> SaveAsync(
        string folder,
        Stream content,
        string extension,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(content);

        if (!SafeFolder.IsMatch(folder))
            throw new ArgumentException($"Недопустимое имя папки: «{folder}»", nameof(folder));

        var normalized = (extension ?? string.Empty).Trim().ToLowerInvariant();
        if (!SafeExtension.IsMatch(normalized))
            throw new ArgumentException($"Недопустимое расширение: «{extension}»", nameof(extension));

        if (!content.CanRead)
            throw new ArgumentException("Поток не читается", nameof(content));

        var directory = Path.Combine(_rootPath, folder);
        Directory.CreateDirectory(directory);

        // Имя генерирует сервер. Клиентское имя не используется вообще — это
        // исключает и обход пути, и подмену чужого файла.
        var fileName = Guid.NewGuid().ToString("N") + normalized;
        var path = Path.Combine(directory, fileName);

        long size;
        try
        {
            await using var target = new FileStream(
                path, FileMode.CreateNew, FileAccess.Write, FileShare.None, bufferSize: 81_920,
                useAsync: true);

            await content.CopyToAsync(target, ct);
            size = target.Length;
        }
        catch
        {
            // Недописанный файл на диске — это «есть картинка размером 0 байт»,
            // которую никто не найдёт и не почистит. Убираем за собой.
            TryDelete(path);
            throw;
        }

        if (size == 0)
        {
            // Пустой поток — это не файл, а признак ошибки выше по стеку.
            // Оставлять его на диске значит отдать в браузер битую картинку.
            TryDelete(path);
            throw new ArgumentException("Пустой поток — сохранять нечего", nameof(content));
        }

        _logger.LogInformation("Сохранён медиафайл {Folder}/{FileName} ({Size} байт)", folder, fileName, size);

        return new MediaFile(BuildPublicUrl(folder, fileName), size);
    }

    public Task<bool> DeleteAsync(string? publicUrl, CancellationToken ct = default)
    {
        var path = TryResolvePath(publicUrl);
        if (path == null)
        {
            // Адрес чужой, битый или ведёт за пределы хранилища. Молча
            // возвращаем false: вызывающему важно «файла больше нет», а не
            // причина, по которой его не было.
            return Task.FromResult(false);
        }

        if (!File.Exists(path)) return Task.FromResult(false);

        try
        {
            File.Delete(path);
            return Task.FromResult(true);
        }
        catch (IOException ex)
        {
            // Файл занят (например, его читает антивирус). Это не повод ронять
            // удаление слова — БД уже обновлена, а файл подберёт чистка.
            _logger.LogWarning(ex, "Не удалось удалить медиафайл {Path}", path);
            return Task.FromResult(false);
        }
    }

    /// <summary>
    /// Публичный адрес → путь на диске, или null, если путь выходит за корень.
    ///
    /// Проверка через GetFullPath + StartsWith, а не «в строке нет ..»:
    /// символические ссылки и юникод-нормализация обходят строковые проверки,
    /// а сравнение нормализованных абсолютных путей — нет.
    /// </summary>
    private string? TryResolvePath(string? publicUrl)
    {
        if (string.IsNullOrWhiteSpace(publicUrl)) return null;

        var prefixWithSlash = _publicPrefix + "/";
        var trimmed = publicUrl.Trim();

        // Абсолютные адреса CDN (если префикс настраивают на домен) — не наши
        // файлы на диске.
        if (Uri.TryCreate(trimmed, UriKind.Absolute, out _)) return null;

        if (!trimmed.StartsWith(prefixWithSlash, StringComparison.Ordinal))
        {
            // Допускаем адрес без префикса — так лежат старые записи вроде
            // «/uploads/word-images/x.webp»: для них корень вычисляется от
            // фактического расположения файла, а не от префикса.
            if (!trimmed.StartsWith('/')) return null;
        }

        var relative = trimmed.StartsWith(prefixWithSlash, StringComparison.Ordinal)
            ? trimmed[prefixWithSlash.Length..]
            : trimmed.TrimStart('/');

        var decoded = Uri.UnescapeDataString(relative);

        // Собираем путь и нормализуем. GetFullPath уже свернёт «..».
        var candidate = Path.GetFullPath(Path.Combine(_rootPath, decoded));

        // Сравнение с завершающим разделителем обязательно: иначе корень
        // «/media» пропустил бы соседний каталог «/media-backup».
        var rootWithSeparator = _rootPath.EndsWith(Path.DirectorySeparatorChar)
            ? _rootPath
            : _rootPath + Path.DirectorySeparatorChar;

        if (!candidate.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase))
            return null;

        return candidate;
    }

    private void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception ex) { _logger.LogWarning(ex, "Не удалось удалить недописанный файл {Path}", path); }
    }
}
