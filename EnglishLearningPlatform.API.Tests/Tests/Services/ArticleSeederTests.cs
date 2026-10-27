using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services.Articles;
using EnglishLearningPlatform.API.Services.Seed;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Tests.Services;

/// <summary>
/// Сидер статей.
///
/// Два свойства важнее содержимого: повторный старт ничего не дублирует, и
/// правки админа не откатываются к заводским. Второе — то, что ломается чаще
/// всего: сидер, который «гарантирует наличие», затирает переименованный
/// раздел при каждом деплое.
/// </summary>
public class ArticleSeederTests
{
    private static ApplicationDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("articles-seed-" + Guid.NewGuid())
            .Options;
        return new ApplicationDbContext(options);
    }

    private static ArticleSeeder Seeder(ApplicationDbContext context) =>
        new(context, new MarkdownRenderer(), NullLogger<ArticleSeeder>.Instance);

    [Fact]
    public async Task Первый_запуск_создаёт_разделы_и_черновик()
    {
        var context = NewContext();

        await Seeder(context).SeedAsync();

        var sections = await context.ArticleSections.ToListAsync();
        Assert.Equal(4, sections.Count);

        var starter = await context.Articles.SingleAsync();
        Assert.Equal("kak-chitat-knigu", starter.Slug);
        // Черновик, а не published: публиковать от имени админа текст, которого
        // он не писал, — значит приписать ему авторство.
        Assert.Equal(ArticleStatus.Draft, starter.Status);
        Assert.Null(starter.PublishedAt);
    }

    [Fact]
    public async Task Повторный_запуск_ничего_не_дублирует()
    {
        var context = NewContext();
        await Seeder(context).SeedAsync();
        await Seeder(context).SeedAsync();

        Assert.Equal(4, await context.ArticleSections.CountAsync());
        Assert.Equal(1, await context.Articles.CountAsync());
    }

    [Fact]
    public async Task Переименованный_админом_раздел_не_откатывается()
    {
        var context = NewContext();
        await Seeder(context).SeedAsync();

        var grammar = await context.ArticleSections.SingleAsync(s => s.Slug == "grammar");
        grammar.Name = "Грамматика по полочкам";
        grammar.Description = "Мой текст";
        await context.SaveChangesAsync();

        await Seeder(context).SeedAsync();

        var after = await context.ArticleSections.SingleAsync(s => s.Slug == "grammar");
        Assert.Equal("Грамматика по полочкам", after.Name);
        Assert.Equal("Мой текст", after.Description);
    }

    [Fact]
    public async Task Удалённый_раздел_не_воскрешается()
    {
        // Админ удалил раздел намеренно. Сидер, который «гарантирует наличие»,
        // вернул бы его при следующем старте — и удаление перестало бы работать.
        var context = NewContext();
        await Seeder(context).SeedAsync();

        var practice = await context.ArticleSections.SingleAsync(s => s.Slug == "practice");
        practice.DeletedAt = DateTime.UtcNow;
        await context.SaveChangesAsync();

        await Seeder(context).SeedAsync();

        var stillDeleted = await context.ArticleSections
            .IgnoreQueryFilters()
            .SingleAsync(s => s.Slug == "practice");
        Assert.NotNull(stillDeleted.DeletedAt);
        Assert.Equal(4, await context.ArticleSections.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task Удалённая_стартовая_статья_не_воскрешается()
    {
        var context = NewContext();
        await Seeder(context).SeedAsync();

        var starter = await context.Articles.SingleAsync();
        starter.DeletedAt = DateTime.UtcNow;
        starter.DeletedByUserId = "admin-1";
        await context.SaveChangesAsync();

        await Seeder(context).SeedAsync();

        Assert.Equal(1, await context.Articles.IgnoreQueryFilters().CountAsync());
        Assert.Null(await context.Articles.FirstOrDefaultAsync());
    }

    [Fact]
    public async Task Черновик_стартовой_статьи_отрендерен_в_html()
    {
        // BodyHtml NOT NULL, и пустая строка означала бы, что при публикации
        // страница откроется без текста — читатель увидит пустоту.
        var context = NewContext();
        await Seeder(context).SeedAsync();

        var starter = await context.Articles.SingleAsync();
        Assert.False(string.IsNullOrWhiteSpace(starter.BodyHtml));
        Assert.Contains("<h1", starter.BodyHtml);
        Assert.Contains("<li>", starter.BodyHtml);
    }
}
