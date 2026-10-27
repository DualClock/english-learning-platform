namespace EnglishLearningPlatform.API.Models.DTOs;

/*
 * Типы гостевого чтения (R2).
 *
 * Отдельный файл, а не добавка к ReaderDtos.cs, потому что контракт другой:
 * в этих ответах НЕТ ни кармана, ни прогресса, ни закладок, а вместо статусов
 * слов пользователя — только «перевода в справочнике нет». Общий тип с
 * аутентифицированной читалкой потащил бы на анонимный путь поля, которые
 * там нечем заполнить, и следующий человек решил бы, что гость может писать
 * прогресс.
 */

/// <summary>Запись каталога гостя: только то, что нужно карточке и превью.</summary>
public sealed class GuestBookSummaryDto
{
    public string Slug { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Author { get; set; }
    public string? CefrLevel { get; set; }

    /// <summary>
    /// Сколько глав в книге. null — книга есть в каталоге (сид), но системной
    /// копии с файлом ещё нет: обещать «12 глав» было бы выдумкой.
    /// </summary>
    public int? ChapterCount { get; set; }
}

public sealed class GuestBookListResponse
{
    public int Total { get; set; }
    public List<GuestBookSummaryDto> Books { get; set; } = new();
}

/// <summary>Манифест для страницы превью: книга, первая глава, потолки.</summary>
public sealed class GuestBookManifestDto
{
    public string Slug { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Author { get; set; }
    public string? CefrLevel { get; set; }
    public string? Description { get; set; }
    public string? CoverUrl { get; set; }

    /// <summary>false — текста ещё нет (сид без системной копии), показывать нечего.</summary>
    public bool HasText { get; set; }

    public int ChapterCount { get; set; }
    public int WordCount { get; set; }

    /// <summary>Всегда ровно одна глава — первая. Список, чтобы фронт не отличался от читалки.</summary>
    public List<GuestChapterLinkDto> Chapters { get; set; } = new();

    /// <summary>Только первая глава открыта гостю; остальные — за аккаунтом.</summary>
    public int? ChaptersAvailableToGuest { get; set; }

    /// <summary>Куда ведёт «сохранить слово»: форма регистрации, не API.</summary>
    public string SignupUrl { get; set; } = "/onboarding";
}

public sealed class GuestChapterLinkDto
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int Index { get; set; }
    public int WordCount { get; set; }
}

/// <summary>
/// Глава для гостя. Структура блоков та же, что в ReaderChapterDto (её умеет
/// рисовать фронт), но без wordStatus/difficulty: они считаются по словарю
/// пользователя, а у гостя пользователя нет.
/// </summary>
public sealed class GuestChapterDto
{
    public string BookSlug { get; set; } = string.Empty;
    public string BookTitle { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int Index { get; set; }
    public int TotalChapters { get; set; }
    public int WordStart { get; set; }
    public int WordCount { get; set; }
    public List<ReaderBlockDto> Blocks { get; set; } = new();

    /// <summary>true — это первая глава и последняя, доступная без аккаунта.</summary>
    public bool IsPreview { get; set; } = true;

    public bool Truncated { get; set; }

    public string ContinueUrl { get; set; } = "/onboarding";
}

/// <summary>
/// Перевод слова из WordLevels. TranslationRu == null — слова нет в
/// справочнике: гостю AI не вызываем, фронт показывает «перевод станет
/// доступен с аккаунтом» и CTA.
/// </summary>
public sealed class GuestWordLookupDto
{
    public string Word { get; set; } = string.Empty;

    /// <summary>Форма, по которой нашлась статья (лемма), если она отличается от слова.</summary>
    public string? MatchedForm { get; set; }

    public string? CefrLevel { get; set; }
    public string? TranslationRu { get; set; }
    public int? FreqRank { get; set; }

    /// <summary>
    /// От чьего имени показан перевод. Для гостя всегда "dictionary":
    /// машинный перевод на этом пути не участвует.
    /// </summary>
    public string Source { get; set; } = "dictionary";

    public string SignupUrl { get; set; } = "/onboarding";
}
