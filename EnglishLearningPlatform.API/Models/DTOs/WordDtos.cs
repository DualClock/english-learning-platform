using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models.DTOs;

// Запрос на добавление слова
public record AddWordRequest(
    [Required] string Text,
    [Required] string Definition,
    string? PartOfSpeech,
    string? Example,
    [MaxLength(20)] string? Source
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
    string? Text,
    string? Definition,
    string? PartOfSpeech,
    string? Example
);