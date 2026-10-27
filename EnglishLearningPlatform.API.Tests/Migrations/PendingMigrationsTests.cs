using EnglishLearningPlatform.API.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;

namespace EnglishLearningPlatform.API.Tests.Migrations;

/// <summary>
/// Пропускающий факт: без Postgres-строки тест обязан быть видимо пропущенным,
/// а не «зелёным». Тихий зелёный — это и есть та ошибка, от которой этот файл
/// защищает: прод отставал от HEAD, все локальные тесты были зелёными, потому
/// что они бегали на SQLite, где истории миграций нет вообще.
///
/// xunit 2.9.3 не умеет Assert.Skip (это xunit.v3), а SkippableFact тянет
/// лишний пакет — поэтому Skip выставляется в конструкторе атрибута до создания
/// тестового класса. Условие берётся из окружения процесса тестов.
/// </summary>
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(MigrationHarness.ConnectionString))
        {
            Skip = $"нет {MigrationHarness.ConnectionVariable}: тест проверяет историю миграций " +
                   "на реальном Postgres и не может быть воспроизведён на SQLite";
        }
    }
}

/// <summary>
/// Поднимает ApplicationDbContext по строке подключения из окружения.
///
/// Миграции проверяются на настоящей базе, потому что в SQLite нет ни
/// __EFMigrationsHistory в том виде, в каком её читает EF, ни частичных
/// индексов из AddFirstChapterActivationIndex. Тест на SQLite «доказывал» бы
/// только то, что файлы миграций скомпилировались.
/// </summary>
public sealed class MigrationHarness : IAsyncDisposable
{
    public const string ConnectionVariable = "LEXICON_TEST_DB_CONNECTION";

    public static string? ConnectionString =>
        Environment.GetEnvironmentVariable(ConnectionVariable) is { Length: > 0 } value ? value : null;

    public ApplicationDbContext Context { get; private set; } = null!;
    private ServiceProvider _provider = null!;

    public static MigrationHarness Create()
    {
        var services = new ServiceCollection();
        services.AddDbContext<ApplicationDbContext>(options =>
            options.UseNpgsql(ConnectionString));

        var harness = new MigrationHarness
        {
            _provider = services.BuildServiceProvider()
        };
        harness.Context = harness._provider.GetRequiredService<ApplicationDbContext>();
        return harness;
    }

    /// <summary>
    /// Миграции, объявленные в коде, без применения. Имена — те, что попали в
    /// форму с SQL — то есть уже безопасны для вывода в сообщение об ошибке.
    /// Синхронный перегруз: GetMigrationsAsync в EF 10 уехал на IMigrator,
    /// а объявленные в сборке миграции от базы не зависят и читаются из кода.
    /// </summary>
    public Task<IReadOnlyList<string>> DeclaredAsync() =>
        Task.FromResult<IReadOnlyList<string>>(Context.Database.GetMigrations().ToList());

    public async Task<IReadOnlyList<string>> AppliedAsync() =>
        (await Context.Database.GetAppliedMigrationsAsync()).ToList();

    public async Task<IReadOnlyList<string>> PendingAsync() =>
        (await Context.Database.GetPendingMigrationsAsync()).ToList();

    public ValueTask DisposeAsync() => _provider.DisposeAsync();
}

/// <summary>
/// Страховка от самой дорогой ошибки деплоя: «прод отстаёт от HEAD».
///
/// 24.10 на боевой базе не были применены AddReaderV3 и AddReaderSpeech, и узнать
/// об этом можно было только по 500 на живом запросе. Локальные 387 тестов этого
/// не видели: они про код, а не про схему. Здесь схема проверяется отдельно и
/// падает с командой, которую надо выполнить.
///
/// Запуск (Windows, git-bash; строка подключения остаётся в окружении):
///   LEXICON_TEST_DB_CONNECTION='Host=localhost;Port=5432;Database=lexicon;Username=...;Password=...' \
///     dotnet test EnglishLearningPlatform.API.Tests --filter FullyQualifiedName~PendingMigrationsTests
///
/// Без переменной оба теста помечаются Skipped — и это видно в выводе.
/// </summary>
public class PendingMigrationsTests
{
    private const string FixCommand =
        "dotnet ef database update --project EnglishLearningPlatform.API";

    [PostgresFact]
    public async Task Database_HasNoPendingMigrations()
    {
        await using var harness = MigrationHarness.Create();

        var pending = await harness.PendingAsync();

        Assert.True(
            pending.Count == 0,
            "В базе не применены: " + string.Join(", ", pending) + ". " +
            "Выполните: " + FixCommand + ". " +
            "Пока они неприменены, новый API падает на вставке в таблицы, которых " +
            "в базе ещё нет, — регистрация отвечает 500, а не 200.");
    }

    /// <summary>
    /// Второй слой: сама история и код должны содержать обе миграции читалки.
    ///
    /// GetPendingMigrationsAsync сравнивает код с историей, поэтому если
    /// миграцию УДАЛИЛИ из кода, она просто исчезнет из обоих списков и первый
    /// тест останется зелёным — при том, что накатить её на свежую базу уже
    /// нечем. Здесь они проверяются явно по имени.
    /// </summary>
    [PostgresFact]
    public async Task ReaderMigrations_AreDeclaredAndApplied()
    {
        await using var harness = MigrationHarness.Create();

        var declared = await harness.DeclaredAsync();
        var applied = (await harness.AppliedAsync()).ToHashSet(StringComparer.Ordinal);

        // Имена — из EF; проверяем по вхождению, потому что префикс даты в новой
        // ветке может отличаться от ветки, на которой миграция создавалась.
        var required = new[] { "AddReaderV3", "AddReaderSpeech" };

        foreach (var name in required)
        {
            var declaredMatch = declared.Where(m => m.EndsWith(name, StringComparison.Ordinal)).ToList();
            Assert.True(
                declaredMatch.Count == 1,
                $"Миграция {name} должна быть объявлена в коде ровно один раз, " +
                $"найдено {declaredMatch.Count}. Если её удалили — накатить её на " +
                "чистую базу больше нечем; восстановите файл из git.");

            var migration = declaredMatch[0];
            Assert.True(
                applied.Contains(migration),
                $"Миграция {migration} объявлена, но не применена. Выполните: {FixCommand}");
        }

        // Схема читалки проверяется по самим таблицам, а не по имени класса
        // миграции: имя можно переименовать, а колонок в базе от этого не
        // прибавится. BookContentSnapshots/ReaderPocketWords/UserBookProgresses
        // создаёт AddReaderV3, SpeechUsages — AddReaderSpeech.
        foreach (var table in new[] { "BookContentSnapshots", "ReaderPocketWords", "UserBookProgresses", "SpeechUsages" })
        {
            var exists = await harness.Context.Database
                .SqlQuery<bool>($"SELECT to_regclass({"\"" + table + "\""}) IS NOT NULL AS \"Value\"")
                .SingleAsync();

            Assert.True(
                exists,
                $"Таблицы {table} в базе нет — миграция читалки не применена. Выполните: {FixCommand}");
        }
    }
}
