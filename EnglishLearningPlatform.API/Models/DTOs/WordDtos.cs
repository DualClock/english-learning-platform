using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models.DTOs;

// Запрос на добавление слова. Перевод необязателен: слово можно сохранить
// на слух или из книги, а перевод добавить позже.
public record AddWordRequest(
    [property: Required, MaxLength(100)] string Text,
    [property: MaxLength(2000)] string? Definition,
    [property: MaxLength(50)] string? PartOfSpeech,
    [property: MaxLength(1000)] string? Example,
    [property: MaxLength(20)] string? Source,
    [property: MaxLength(500)] string? Context
);

// Ответ со словом. Example/ExampleRu — пример из справочника WordLevels (R11):
// английское предложение и его русский перевод. null значит «примера нет»,
// и карточка показывает только перевод, не пустую строку.
public record WordResponse(
    int Id,
    string Text,
    string? Language,
    List<DefinitionResponse> Definitions,
    DateTime CreatedAt,
    string? Source = null,
    string? Context = null,
    string? Emoji = null,
    string? ImageUrl = null,
    string? CategoryIcon = null,
    string? Example = null,
    string? ExampleRu = null
);

public record DefinitionResponse(
    int Id,
    string Definition,
    string? PartOfSpeech,
    string? Example
);

// Запрос на обновление
public record UpdateWordRequest(
    [property: MaxLength(100)] string? Text,
    [property: MaxLength(2000)] string? Definition,
    [property: MaxLength(50)] string? PartOfSpeech,
    [property: MaxLength(1000)] string? Example
);