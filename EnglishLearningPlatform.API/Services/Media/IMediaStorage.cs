namespace EnglishLearningPlatform.API.Services.Media;

/// <summary>
/// Хранилище загружаемых файлов.
///
/// Абстракция существует ровно для одного: переезд на S3/MinIO не должен
/// менять Calling-код. Контроллер знает только «сохрани поток, верни
/// публичный адрес» — где лежит файл, его не касается.
///
/// Что сознательно НЕ входит в контракт: имя файла. Клиент его предложить
/// не может, потому что клиентское имя — это обход пути и подмена чужого
/// файла. Имя генерирует хранилище.
/// </summary>
public interface IMediaStorage
{
    /// <summary>
    /// Сохранить поток. <paramref name="folder"/> — логическая папка
    /// («word-images», «article-covers»), <paramref name="extension"/> —
    /// с точкой (".webp").
    /// </summary>
    Task<MediaFile> SaveAsync(
        string folder,
        Stream content,
        string extension,
        CancellationToken ct = default);

    /// <summary>
    /// Удалить по публичному адресу. False — файла не было.
    /// НЕ бросает на отсутствующем файле: повторное удаление — норма.
    /// </summary>
    Task<bool> DeleteAsync(string? publicUrl, CancellationToken ct = default);

    /// <summary>
    /// Публичный адрес по имени. Нужен там, где известна только пара
    /// «папка + имя» (например, при переносе данных).
    /// </summary>
    string BuildPublicUrl(string folder, string fileName);
}

/// <summary>Результат сохранения.</summary>
/// <param name="PublicUrl">Адрес для <c>&lt;img src&gt;</c> и для БД.</param>
/// <param name="SizeBytes">Сколько записано — для логов и лимитов.</param>
public sealed record MediaFile(string PublicUrl, long SizeBytes);
