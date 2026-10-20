using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models.DTOs;

// Запрос на добавление слова
public record AddWordRequest(
    [property: Required, MaxLength(100)] string Text,
    [property: Required, MaxLength(2000)] string Definition,
    [property: MaxLength(50)] string? PartOfSpeech,
    [property: MaxLength(1000)] string? Example,
    [property: MaxLength(20)] string? Source
);

// Ответ со словом
public record WordResponse(
    int Id,
    string Text,
    string? Language,
    List<DefinitionResponse> Definitions,
    DateTime CreatedAt
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