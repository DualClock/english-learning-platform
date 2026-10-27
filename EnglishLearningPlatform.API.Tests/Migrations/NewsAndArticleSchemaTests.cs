using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests.Migrations;

/// <summary>
/// Схема новостей, статей и интересов.
///
/// Тесты держат два класса ошибок, каждый из которых проявляется не сразу:
///
///  1. Дедупликация новостей. Фетчер запускается и по таймеру, и кнопкой
///     «Обновить сейчас». Без уникального индекса по ExternalId параллельный
///     запуск удваивает ленту, и человек видит одну и ту же новость дважды.
///     Проверка в коде это не ловит — ловит только уникальный индекс.
///
///  2. Раздел статьи не должен уносить тексты. Cascade по SectionId уничтожил
///     бы статьи раздела при его удалении; правильное поведение — SetNull,
///     чтобы тексты переехали в «без раздела» и их можно было разложить заново.
/// </summary>
public class NewsAndArticleSchemaTests
{
    private static ApplicationDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    // ─────────────────────────────────────────────────────── новости

    [Fact]
    public void NewsItem_ExternalId_IsUniqueIndex()
    {
        using var context = CreateContext();

        var index = context.Model.FindEntityType(typeof(NewsItem))!
            .GetIndexes()
            .SingleOrDefault(i => i.Properties.Any(p => p.Name == "ExternalId"));

        Assert.NotNull(index);
        Assert.True(index!.IsUnique, "без уникальности ExternalId опрос ленты создаст дубли");
    }

    [Fact]
    public void NewsItem_HasFeedLookupIndexes()
    {
        using var context = CreateContext();
        var indexes = context.Model.FindEntityType(typeof(NewsItem))!.GetIndexes().ToList();

        // Выдача на главной фильтрует по IsHidden и сортирует по PublishedAt.
        Assert.Contains(indexes, i => i.Properties.Any(p => p.Name == "IsHidden")
                                      && i.Properties.Any(p => p.Name == "PublishedAt"));
        // Уборка старых новостей — по FetchedAt.
        Assert.Contains(indexes, i => i.Properties.Any(p => p.Name == "FetchedAt"));
    }

    [Fact]
    public void NewsItem_TopicsIsPlainString_NotArray()
    {
        // Это осознанное решение: фильтр по интересам маленький, а text[]
        // усложнил бы запросы ради выигрыша на десятках строк.
        var property = typeof(NewsItem).GetProperty(nameof(NewsItem.Topics));

        Assert.NotNull(property);
        Assert.Equal(typeof(string), property!.PropertyType);
    }

    // ─────────────────────────────────────────────────────── статьи

    [Fact]
    public void Article_Slug_IsUniqueOnlyAmongLive()
    {
        using var context = CreateContext();

        var index = context.Model.FindEntityType(typeof(Article))!
            .GetIndexes()
            .Single(i => i.IsUnique && i.Properties.Any(p => p.Name == "Slug"));

        // Частичный индекс: удалённая статья не должна занимать слаг навсегда.
        Assert.NotNull(index.GetFilter());
        Assert.Contains("DeletedAt", index.GetFilter()!, StringComparison.Ordinal);
    }

    [Fact]
    public void ArticleSection_Slug_IsUniqueOnlyAmongLive()
    {
        using var context = CreateContext();

        var index = context.Model.FindEntityType(typeof(ArticleSection))!
            .GetIndexes()
            .Single(i => i.IsUnique && i.Properties.Any(p => p.Name == "Slug"));

        Assert.NotNull(index.GetFilter());
        Assert.Contains("DeletedAt", index.GetFilter()!, StringComparison.Ordinal);
    }

    [Fact]
    public void DeletingSection_DoesNotDeleteArticles()
    {
        // SetNull, а не Cascade: удаление рубрики — это не удаление текстов.
        using var context = CreateContext();

        var fk = context.Model.FindEntityType(typeof(Article))!
            .GetForeignKeys()
            .Single(f => f.PrincipalEntityType.ClrType == typeof(ArticleSection));

        Assert.Equal(DeleteBehavior.SetNull, fk.DeleteBehavior);
    }

    [Fact]
    public void DeletingArticle_RemovesItsRevisions()
    {
        // Ревизии без статьи — сироты, которые никто не читает.
        using var context = CreateContext();

        var fk = context.Model.FindEntityType(typeof(ArticleRevision))!
            .GetForeignKeys()
            .Single(f => f.PrincipalEntityType.ClrType == typeof(Article));

        Assert.Equal(DeleteBehavior.Cascade, fk.DeleteBehavior);
    }

    [Fact]
    public void Article_And_Section_AreSoftDeletable()
    {
        using var context = CreateContext();

        Assert.IsAssignableFrom<ISoftDeletable>(new Article());
        Assert.IsAssignableFrom<ISoftDeletable>(new ArticleSection());

        // И у обоих есть глобальный фильтр, иначе удалённое полезет на сайт.
        Assert.NotNull(context.Model.FindEntityType(typeof(Article))!.GetQueryFilter());
        Assert.NotNull(context.Model.FindEntityType(typeof(ArticleSection))!.GetQueryFilter());
    }

    [Fact]
    public void ArticleStatus_Validation_RejectsTypos()
    {
        // Опечатка в статусе иначе даёт статью, которую не видит никто.
        Assert.True(ArticleStatus.IsValid("draft"));
        Assert.True(ArticleStatus.IsValid("published"));
        Assert.True(ArticleStatus.IsValid("archived"));

        Assert.False(ArticleStatus.IsValid("pubished"));
        Assert.False(ArticleStatus.IsValid("Draft"));  // регистр значим
        Assert.False(ArticleStatus.IsValid(null));
    }

    [Fact]
    public async Task DraftArticle_IsInvisibleToPublicFilter()
    {
        using var context = CreateContext();
        context.Articles.Add(new Article
        {
            Slug = "draft-one", Title = "Черновик", BodyMarkdown = "",
            Status = ArticleStatus.Draft
        });
        await context.SaveChangesAsync();

        // Черновик существует в базе, но публичная выборка его не отдаёт.
        var published = await context.Articles
            .Where(a => a.Status == ArticleStatus.Published)
            .ToListAsync();

        Assert.Empty(published);
        Assert.Single(await context.Articles.ToListAsync());
    }

    // ─────────────────────────────────────────────────────── интересы

    [Fact]
    public void UserInterest_IsUniquePerUserAndTopic()
    {
        using var context = CreateContext();

        var index = context.Model.FindEntityType(typeof(UserInterest))!
            .GetIndexes()
            .Single(i => i.IsUnique && i.Properties.Count() == 2);

        Assert.Contains(index.Properties, p => p.Name == "UserId");
        Assert.Contains(index.Properties, p => p.Name == "Interest");
    }

    [Fact]
    public void Interests_Normalize_MapsSourceRubricsToOurKeys()
    {
        // Источники пишут рубрики по-своему. Без нормализации человек с
        // выбранным «Спорт» видит пустоту при десяти спортивных новостях.
        Assert.Equal("sport", Interests.Normalize("Sports"));
        Assert.Equal("sport", Interests.Normalize("football"));
        Assert.Equal("news", Interests.Normalize("World news"));
        Assert.Equal("culture", Interests.Normalize("Entertainment"));
        Assert.Equal("nature", Interests.Normalize("Animals"));
        Assert.Equal("interesting", Interests.Normalize("незнакомая рубрика"));
        Assert.Equal("interesting", Interests.Normalize(null));
    }

    [Fact]
    public void Interests_Normalize_AlwaysProducesKnownKey()
    {
        // Инвариант, на котором держится фильтр: результат нормализации
        // обязан существовать в справочнике, иначе интерес не совпадёт никогда.
        foreach (var raw in new[] { "News", "Sport", "sport", "science", "xyz", "", null })
        {
            var key = Interests.Normalize(raw);
            Assert.True(Interests.All.ContainsKey(key),
                $"Normalize(\"{raw}\") = \"{key}\" отсутствует в справочнике");
        }
    }

    [Fact]
    public void Interests_CatalogKeysAreLowercase()
    {
        // Ключи сравниваются ordinal — регистр в справочнике должен быть
        // нормализован, иначе «Sport» в базе не найдёт «sport» в фильтре.
        Assert.All(Interests.All.Keys, key =>
            Assert.Equal(key.ToLowerInvariant(), key));
    }
}
