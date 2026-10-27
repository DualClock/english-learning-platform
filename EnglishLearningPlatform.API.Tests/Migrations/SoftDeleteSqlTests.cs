using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace EnglishLearningPlatform.API.Tests.Migrations;

/// <summary>
/// CMS-1: filtered include на настоящем переводчике запросов.
///
/// Зачем отдельно от SoftDeleteTests: InMemory-провайдер НЕ применяет
/// `.Where(...)` внутри `.Include(...)` — он игнорирует фильтр навигации и
/// возвращает удалённые строки. Тест «выдача категории без удалённых слов» на
/// InMemory прошёл бы только случайно или не прошёл бы вовсе, ничего не говоря
/// о проде.
///
/// Здесь проверяется SQL, который EF сгенерирует для Npgsql: в тексте запроса
/// должно быть условие по DeletedAt. Проверка через реального провайдера, но
/// без подключения к базе — ToQueryString() строит SQL, не выполняя его.
/// </summary>
public class SoftDeleteSqlTests
{
    private static ApplicationDbContext CreateNpgsqlContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql("Host=localhost;Database=probe;Username=probe;Password=probe")
            // Без защитника: нам нужен только текст SQL, контекст не подключается.
            .ConfigureWarnings(w => w.Ignore(CoreEventId.NavigationBaseIncludeIgnored))
            .Options);

    [Fact]
    public void CategoryWordsQuery_FiltersDeletedWordsInSql()
    {
        using var context = CreateNpgsqlContext();

        var sql = context.Categories
            .AsNoTracking()
            .Include(c => c.Words.Where(w => w.DeletedAt == null))
            .ToQueryString();

        // Npgsql транслирует фильтр навигации в подзапрос LEFT JOIN:
        //   LEFT JOIN (SELECT ... FROM "CategoryWords" AS c0
        //              WHERE c0."DeletedAt" IS NULL) AS c1 ON ...
        Assert.Contains("WHERE c0.\"DeletedAt\" IS NULL", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void CategoryWordsQuery_WithoutFilter_DoesNotCarryCondition()
    {
        // Контроль: та же форма запроса без фильтра — условия нет. Иначе
        // предыдущий тест проверял бы совпадение в имени колонки.
        using var context = CreateNpgsqlContext();

        var sql = context.Categories
            .AsNoTracking()
            .Include(c => c.Words)
            .ToQueryString();

        Assert.DoesNotContain("c0.\"DeletedAt\" IS NULL", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void WordQuery_CarriesGlobalFilterInSql()
    {
        // Глобальный фильтр обязан попадать в SQL, а не разбираться в памяти:
        // иначе он не защищает от забывчивости в горячих запросах.
        using var context = CreateNpgsqlContext();

        var sql = context.Words.AsNoTracking().ToQueryString();

        Assert.Contains("DeletedAt", sql, StringComparison.Ordinal);
        Assert.Contains("IS NULL", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void BookQuery_CarriesGlobalFilterInSql()
    {
        using var context = CreateNpgsqlContext();

        var sql = context.Books.AsNoTracking().ToQueryString();

        Assert.Contains("DeletedAt", sql, StringComparison.Ordinal);
        Assert.Contains("IS NULL", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void IgnoreQueryFilters_RemovesTheCondition()
    {
        // Контроль: без IgnoreQueryFilters условие есть, с ним — нет. Если бы
        // ToQueryString не отражал фильтр, предыдущие тесты были бы ложно
        // зелёными.
        //
        // Сравниваем с WHERE-условием, а не с именем колонки: DeletedAt есть и
        // в SELECT-списке обоих вариантов. Npgsql инлайнит сравнение:
        //   WHERE w."DeletedAt" IS NULL
        using var context = CreateNpgsqlContext();

        var withFilter = context.Words.AsNoTracking().ToQueryString();
        var withoutFilter = context.Words.AsNoTracking().IgnoreQueryFilters().ToQueryString();

        const string condition = "WHERE w.\"DeletedAt\" IS NULL";

        Assert.Contains(condition, withFilter, StringComparison.Ordinal);
        Assert.DoesNotContain(condition, withoutFilter, StringComparison.Ordinal);
    }
}
