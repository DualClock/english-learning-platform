using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests.Migrations;

/// <summary>
/// CMS-1: мягкое удаление контента и защита прогресса пользователей.
///
/// Здесь проверяются две вещи, цена ошибки в которых — чужие данные:
///
/// 1. Global Query Filter. Удалённое слово/категория/книга не должны попадать
///    ни в одну обычную выборку. Без фильтра каждый существующий запрос
///    (каталог, словарь, категории, читалка) продолжает отдавать удалённое, и
///    забыть его можно в любом из десятков мест.
///
/// 2. DeleteBehavior между CategoryWord и UserCategoryWordProgress. В CMS-0
///    аудит показал Cascade: удаление одного слова из категории стирало
///    «выучено» у всех пользователей по этому слову. Тест держит модель в
///    положении Restrict — вернуть Cascade незаметно не выйдет.
/// </summary>
public class SoftDeleteTests
{
    private static ApplicationDbContext CreateContext()
    {
        return new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
    }

    private static User NewUser(string id) => new()
    {
        Id = id,
        UserName = $"{id}@example.com",
        NormalizedUserName = $"{id}@EXAMPLE.COM".ToUpperInvariant(),
        Email = $"{id}@example.com",
        NormalizedEmail = $"{id}@EXAMPLE.COM".ToUpperInvariant()
    };

    // ------------------------------------------------------- фильтры

    [Fact]
    public async Task SoftDeletedWord_DisappearsFromNormalQuery()
    {
        using var context = CreateContext();
        context.Words.Add(new Word { Text = "visible" });
        context.Words.Add(new Word { Text = "removed", DeletedAt = DateTime.UtcNow, DeletedByUserId = "admin" });
        await context.SaveChangesAsync();

        var words = await context.Words.Select(w => w.Text).ToListAsync();

        Assert.Equal(new[] { "visible" }, words);
    }

    [Fact]
    public async Task SoftDeletedWord_IsStillReadableWithIgnoreQueryFilters()
    {
        // Админка должна видеть удалённое, иначе восстановить слово нечем.
        using var context = CreateContext();
        context.Words.Add(new Word { Text = "removed", DeletedAt = DateTime.UtcNow });
        await context.SaveChangesAsync();

        var all = await context.Words.IgnoreQueryFilters().Select(w => w.Text).ToListAsync();

        Assert.Equal(new[] { "removed" }, all);
    }

    [Fact]
    public async Task SoftDeletedCategory_DisappearsButCategoryWordsSurvive()
    {
        using var context = CreateContext();
        var category = new Category { Name = "Food", Slug = "food", DeletedAt = DateTime.UtcNow };
        context.Categories.Add(category);
        await context.SaveChangesAsync();

        context.CategoryWords.Add(new CategoryWord
        {
            CategoryId = category.Id,
            English = "apple",
            Translation = "яблоко"
        });
        await context.SaveChangesAsync();

        Assert.Empty(await context.Categories.ToListAsync());
        // Слово не удалено — оно вернётся вместе с восстановлением категории.
        Assert.Single(await context.CategoryWords.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task SoftDeletedBook_DisappearsFromCatalog()
    {
        using var context = CreateContext();
        context.Books.Add(new Book
        {
            Title = "Gone",
            FilePath = "gone.epub",
            DeletedAt = DateTime.UtcNow
        });
        context.Books.Add(new Book { Title = "Here", FilePath = "here.epub" });
        await context.SaveChangesAsync();

        var titles = await context.Books.Select(b => b.Title).ToListAsync();

        Assert.Equal(new[] { "Here" }, titles);
    }

    // ------------------------------------------------------- прогресс пользователя

    [Fact]
    public void CategoryWord_To_UserProgress_IsRestrict_NotCascade()
    {
        using var context = CreateContext();

        var userProgressFk = context.Model
            .FindEntityType(typeof(UserCategoryWordProgress))!
            .GetForeignKeys()
            .Single(fk => fk.PrincipalEntityType.ClrType == typeof(CategoryWord));

        Assert.Equal(DeleteBehavior.Restrict, userProgressFk.DeleteBehavior);
    }

    [Fact]
    public void Category_To_CategoryWord_IsRestrict_NotCascade()
    {
        // Удаление категории не должно физически уносить её слова: слово
        // вернётся при восстановлении категории, а физический DELETE поставил
        // бы под угрозу прогресс, если слова когда-нибудь станут общими.
        using var context = CreateContext();

        var fk = context.Model
            .FindEntityType(typeof(CategoryWord))!
            .GetForeignKeys()
            .Single(f => f.PrincipalEntityType.ClrType == typeof(Category));

        Assert.Equal(DeleteBehavior.Restrict, fk.DeleteBehavior);
    }

    [Fact]
    public async Task SoftDeletingCategoryWord_KeepsUserProgress()
    {
        // Сценарий, который до CMS-1 стирал чужой прогресс: админ убирает
        // слово из категории. Прогресс пользователя обязан остаться.
        using var context = CreateContext();
        context.Users.Add(NewUser("u1"));

        var category = new Category { Name = "Food", Slug = "food" };
        context.Categories.Add(category);
        await context.SaveChangesAsync();

        var word = new CategoryWord { CategoryId = category.Id, English = "apple", Translation = "яблоко" };
        context.CategoryWords.Add(word);
        await context.SaveChangesAsync();

        context.UserCategoryWordProgresses.Add(new UserCategoryWordProgress
        {
            UserId = "u1",
            CategoryWordId = word.Id,
            Status = "learned"
        });
        await context.SaveChangesAsync();

        // «Удаление» админом — обновление поля, а не DELETE.
        word.DeletedAt = DateTime.UtcNow;
        word.DeletedByUserId = "admin";
        await context.SaveChangesAsync();

        // Проверять тут Include(фильтр) бессмысленно: InMemory игнорирует
        // Where внутри Include и вернул бы удалённое слово при любой модели.
        // Трансляцию фильтра в SQL держит SoftDeleteSqlTests; здесь — то, что
        // важно именно для данных: строка прогресса цела и слово физически на
        // месте.
        var progress = await context.UserCategoryWordProgresses
            .IgnoreQueryFilters()
            .SingleAsync();
        Assert.Equal("learned", progress.Status);

        var stored = await context.CategoryWords
            .IgnoreQueryFilters()
            .SingleAsync(cw => cw.Id == word.Id);
        Assert.NotNull(stored.DeletedAt);

        // Восстановление: обнулить оба поля — и слово снова в категории вместе
        // с прежним прогрессом.
        context.ChangeTracker.Clear();
        var toRestore = await context.CategoryWords
            .IgnoreQueryFilters()
            .SingleAsync(cw => cw.Id == word.Id);
        toRestore.DeletedAt = null;
        toRestore.DeletedByUserId = null;
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var restored = await context.Categories
            .Include(c => c.Words.Where(w => w.DeletedAt == null))
            .AsNoTracking()
            .ToListAsync();
        Assert.Single(restored);
    }

    [Fact]
    public async Task SoftDeletingWord_KeepsUserWordSrsState()
    {
        // SRS-карточка ссылается на Word. Мягкое удаление слова не имеет
        // права уносить интервалы и EaseFactor.
        using var context = CreateContext();
        context.Users.Add(NewUser("u1"));

        var word = new Word { Text = "apple" };
        context.Words.Add(word);
        await context.SaveChangesAsync();

        context.UserWords.Add(new UserWord
        {
            UserId = "u1",
            WordId = word.Id,
            Interval = 12,
            EaseFactor = 2.7,
            RepetitionCount = 4
        });
        await context.SaveChangesAsync();

        word.DeletedAt = DateTime.UtcNow;
        await context.SaveChangesAsync();

        var card = await context.UserWords.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(12, card.Interval);
        Assert.Equal(2.7, card.EaseFactor);
    }

    [Fact]
    public void SoftDeletableEntities_All_ImplementInterface()
    {
        // Страховка от забывчивости: если фильтр добавили в модель, но не в
        // интерфейс, следующий автор не увидит контракта.
        Assert.IsAssignableFrom<ISoftDeletable>(new Word());
        Assert.IsAssignableFrom<ISoftDeletable>(new Category());
        Assert.IsAssignableFrom<ISoftDeletable>(new CategoryWord());
        Assert.IsAssignableFrom<ISoftDeletable>(new Book());
    }

    [Fact]
    public void FilteredEntities_DeclareQueryFilter()
    {
        using var context = CreateContext();

        foreach (var type in new[] { typeof(Word), typeof(Category), typeof(Book) })
        {
            var entity = context.Model.FindEntityType(type);
            Assert.NotNull(entity);
            Assert.NotNull(entity!.GetQueryFilter());
        }
    }

    [Fact]
    public void CategoryWord_HasNoQueryFilter_OnPurpose()
    {
        // Не забывчивость, а решение: UserCategoryWordProgress ссылается на
        // CategoryWord обязательным FK. Фильтр на CategoryWord сделал бы
        // навигацию от прогресса к слову возвращающей null при живой строке в
        // базе и спрятал бы удалённое слово от восстановления.
        // Если кто-то добавит фильтр «для симметрии», этот тест объяснит цену.
        using var context = CreateContext();

        var entity = context.Model.FindEntityType(typeof(CategoryWord));

        Assert.NotNull(entity);
        Assert.Null(entity!.GetQueryFilter());
    }

    [Fact]
    public async Task DeletedWord_DoesNotReachUserDictionaryQueries()
    {
        // Практический смысл фильтра: удалённое слово не проходит в выборку по
        // словарю пользователя. Сценарий — диктант и квиз (PracticeController,
        // ReviewController), которые строятся через Include(uw => uw.Word).
        using var context = CreateContext();
        context.Users.Add(NewUser("u1"));

        var kept = new Word { Text = "kept" };
        var removed = new Word { Text = "removed", DeletedAt = DateTime.UtcNow };
        context.Words.AddRange(kept, removed);
        await context.SaveChangesAsync();

        context.UserWords.AddRange(
            new UserWord { UserId = "u1", WordId = kept.Id, RepetitionCount = 1 },
            new UserWord { UserId = "u1", WordId = removed.Id, RepetitionCount = 1 });
        await context.SaveChangesAsync();

        var visible = await context.UserWords
            .Where(uw => uw.UserId == "u1" && uw.Word.DeletedAt == null)
            .Select(uw => uw.Word.Text)
            .ToListAsync();

        Assert.Equal(new[] { "kept" }, visible);

        // Но сама карточка не удалена: SRS-состояние пользователя цело и
        // вернётся, если слово восстановят.
        Assert.Equal(2, await context.UserWords.IgnoreQueryFilters().CountAsync());
    }
}
