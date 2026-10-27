using FluentValidation;
using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services;

namespace EnglishLearningPlatform.API.Validators;

public class AddWordRequestValidator : AbstractValidator<AddWordRequest>
{
    public AddWordRequestValidator()
    {
        RuleFor(x => x.Text)
            .NotEmpty().WithMessage("Слово обязательно")
            .MinimumLength(1).WithMessage("Слово не может быть пустым")
            .MaximumLength(100).WithMessage("Слово не может быть длиннее 100 символов")
            .Matches(@"^[a-zA-Z\s\-']+$").WithMessage("Только английские буквы, пробелы, дефисы и апострофы");

        RuleFor(x => x.Definition)
            .MaximumLength(500).WithMessage("Перевод не может быть длиннее 500 символов")
            .When(x => !string.IsNullOrWhiteSpace(x.Definition));

        RuleFor(x => x.PartOfSpeech)
            .MaximumLength(50).WithMessage("Часть речи не может быть длиннее 50 символов")
            .When(x => !string.IsNullOrEmpty(x.PartOfSpeech));

        RuleFor(x => x.Example)
            .MaximumLength(500).WithMessage("Пример не может быть длиннее 500 символов")
            .When(x => !string.IsNullOrEmpty(x.Example));

        RuleFor(x => x.Source)
            .MaximumLength(20).WithMessage("Источник не может быть длиннее 20 символов")
            .Must(s => s == null || DictionaryService.AllowedSources.Contains(s))
            .WithMessage("Источник должен быть одним из: manual, reader, key_word, grammar, list, quiz, category, bulk")
            .When(x => !string.IsNullOrEmpty(x.Source));

        RuleFor(x => x.Context)
            .MaximumLength(500).WithMessage("Контекст не может быть длиннее 500 символов")
            .When(x => !string.IsNullOrEmpty(x.Context));
    }
}

public class UpdateWordRequestValidator : AbstractValidator<UpdateWordRequest>
{
    public UpdateWordRequestValidator()
    {
        RuleFor(x => x.Text)
            .MaximumLength(100).WithMessage("Слово не может быть длиннее 100 символов")
            .Matches(@"^[a-zA-Z\s\-']+$").WithMessage("Только английские буквы, пробелы, дефисы и апострофы")
            .When(x => !string.IsNullOrEmpty(x.Text));

        RuleFor(x => x.Definition)
            .MaximumLength(500).WithMessage("Перевод не может быть длиннее 500 символов")
            .When(x => !string.IsNullOrEmpty(x.Definition));
    }
}