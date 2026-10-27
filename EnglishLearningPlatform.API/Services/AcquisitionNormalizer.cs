using System.Text;
using EnglishLearningPlatform.API.Models;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Нормализация и запись атрибуционного канала (W2.1).
///
/// Значения приходят прямо из URL (`?ref=`, `?utm_source=`), то есть их полностью
/// контролирует тот, кто прислал ссылку, а не наш фронтенд. Поэтому в колонку
/// попадает только безопасный алфавит slug'а: строчные латинские буквы, цифры и
/// дефис, длина ограничена размером колонки. Всё остальное — пустое значение,
/// а не «как пришли, так и сохранили»: пользователю нельзя дать записать
/// произвольную строку в чужую выборку.
/// </summary>
public static class AcquisitionNormalizer
{
    /// <summary>Длина колонок User.AcquisitionSource / AcquisitionCode.</summary>
    public const int MaxLength = 64;

    /// <summary>
    /// Приводит метку к slug'у: нижний регистр, все не-буквенно-цифровые символы
    /// становятся одним дефисом, обрамляющие дефисы снимаются, длина обрезается.
    /// Возвращает null, если после очистки не от чего было остаться (например,
    /// кириллица или emoji).
    /// </summary>
    public static string? Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var builder = new StringBuilder(raw.Length);
        var pendingSeparator = false;

        foreach (var ch in raw.Trim().ToLowerInvariant())
        {
            var isAllowed = ch is >= 'a' and <= 'z' or >= '0' and <= '9';
            if (isAllowed)
            {
                // Разделитель ставим только между словами: двойных и хвостовых дефисов не будет
                if (pendingSeparator && builder.Length > 0) builder.Append('-');
                pendingSeparator = false;
                builder.Append(ch);
            }
            else
            {
                pendingSeparator = builder.Length > 0;
            }
        }

        if (builder.Length == 0) return null;

        if (builder.Length > MaxLength)
        {
            builder.Length = MaxLength;
            // Обрезка могла оставить хвостовой дефис — он не часть кода
            while (builder.Length > 0 && builder[^1] == '-')
                builder.Length--;
        }

        return builder.Length == 0 ? null : builder.ToString();
    }

    /// <summary>
    /// Собирает (источник, код) из utm-меток и личного кода `?ref=`.
    ///
    /// Приоритет источника: `ref` > `utm_source` > `utm_medium` — ссылка учителя
    /// конкретнее любой кампании, и именно её мы обещали преподавателю в письме.
    /// Код — это та самая конкретная ссылка: `ref`, а если его нет — `utm_content`
    /// (номер поста или ролика, по которому пришёл человек).
    /// </summary>
    public static (string? Source, string? Code) Resolve(
        string? refCode,
        string? utmSource,
        string? utmMedium,
        string? utmContent)
    {
        var fromRef = Normalize(refCode);
        var source = fromRef ?? Normalize(utmSource) ?? Normalize(utmMedium);
        var code = fromRef ?? Normalize(utmContent);

        return (source, code);
    }

    /// <summary>
    /// Записывает атрибуцию в созданный аккаунт. Уже заполненное поле не
    /// перезаписывается никогда: значение фиксируется в момент регистрации.
    /// </summary>
    public static void ApplyOnCreate(
        User user,
        string? refCode,
        string? utmSource,
        string? utmMedium,
        string? utmContent)
    {
        var (source, code) = Resolve(refCode, utmSource, utmMedium, utmContent);

        if (string.IsNullOrEmpty(user.AcquisitionSource))
            user.AcquisitionSource = source;

        if (string.IsNullOrEmpty(user.AcquisitionCode))
            user.AcquisitionCode = code;
    }
}
