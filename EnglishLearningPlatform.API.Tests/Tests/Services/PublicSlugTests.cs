using EnglishLearningPlatform.API.Services;

namespace EnglishLearningPlatform.API.Tests.Services;

/// <summary>
/// Правила публичного слага. Это единственный генератор адресов /library/&lt;slug&gt;,
/// поэтому здесь закреплены именно те детали, из-за которых иначе появляются
/// дубли в индексе: регистр, апострофы, диакритика, амперсанд, коллизии названий.
/// </summary>
public class PublicSlugTests
{
    [Theory]
    // Классика с апострофом: апостроф выбрасывается, а не превращается в дефис
    [InlineData("Alice's Adventures in Wonderland", "alices-adventures-in-wonderland")]
    [InlineData("Alice’s Adventures in Wonderland", "alices-adventures-in-wonderland")]
    [InlineData("Moby-Dick", "moby-dick")]
    [InlineData("The Picture of Dorian Gray", "the-picture-of-dorian-gray")]
    [InlineData("The Lost Kitten", "the-lost-kitten")]
    // Диакритика снимается, а не превращается в мусор
    [InlineData("Brontë Towers", "bronte-towers")]
    // Пунктуация и кавычки — разделители, их не видно в адресе
    [InlineData("\"The Signal\": A Ghost Story", "the-signal-a-ghost-story")]
    [InlineData("Dr. Jekyll & Mr. Hyde", "dr-jekyll-and-mr-hyde")]
    // Дефисы по краям срезаются
    [InlineData("  — Frankenstein —  ", "frankenstein")]
    public void From_DeterministicLatinSlug(string title, string expected) =>
        Assert.Equal(expected, PublicSlug.From(title));

    [Fact]
    public void From_FallsBackWhenNothingLeft()
    {
        Assert.Equal(PublicSlug.Fallback, PublicSlug.From(null));
        Assert.Equal(PublicSlug.Fallback, PublicSlug.From(""));
        Assert.Equal(PublicSlug.Fallback, PublicSlug.From("   "));
        // Название без единой латинской буквы не может дать читаемый адрес
        Assert.Equal(PublicSlug.Fallback, PublicSlug.From("«» — !!!"));
    }

    [Fact]
    public void From_SameTitleAlwaysGivesSameSlug()
    {
        // Слаг не должен зависеть от состояния процесса: на него ссылается sitemap
        Assert.Equal(
            PublicSlug.From("The Adventures of Sherlock Holmes"),
            PublicSlug.From("The Adventures of Sherlock Holmes"));
    }

    [Fact]
    public void From_TruncatesLongTitleOnHyphenBoundary()
    {
        var slug = PublicSlug.From(
            "The Extremely Long Title Of A Book Which Keeps Going And Going And Never Stops At All");

        Assert.True(slug.Length <= PublicSlug.MaxLength, $"слаг длиннее потолка: {slug.Length}");
        Assert.False(slug.EndsWith('-'), $"обрезан посреди слова: {slug}");
        Assert.DoesNotContain("--", slug);
    }

    [Fact]
    public void AssignSlugs_Collision_GetsUniqueSuffixes()
    {
        var slugs = PublicSlug.AssignSlugs(new[] { "Sea Stories", "Sea Stories", "Sea Stories" });

        Assert.Equal(new[] { "sea-stories", "sea-stories-2", "sea-stories-3" }, slugs);
        Assert.Equal(slugs.Count, slugs.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void AssignSlugs_SuffixNeverOverwritesAnExistingSlug()
    {
        // «sea-stories-2» может быть законным слагом другой книги: суффикс
        // обязан пропустить занятый вариант, иначе два адреса укажут на разные тексты
        var slugs = PublicSlug.AssignSlugs(new[] { "Sea Stories 2", "Sea Stories", "Sea Stories" });

        Assert.Equal(3, slugs.Count);
        Assert.Equal(slugs.Count, slugs.Distinct(StringComparer.Ordinal).Count());
        Assert.Contains("sea-stories-2", slugs);
    }

    [Theory]
    [InlineData("A1", 0)]
    [InlineData("b2", 3)]
    [InlineData("C1", 4)]
    [InlineData(" C2 ", 5)]
    public void LevelOrder_KnowsEveryCefrLevel(string level, int expected) =>
        Assert.Equal(expected, PublicSlug.LevelOrder(level));

    [Fact]
    public void LevelOrder_PutsUnknownLevelLast()
    {
        Assert.True(PublicSlug.LevelOrder(null) > PublicSlug.LevelOrder("C2"));
        Assert.True(PublicSlug.LevelOrder("zz") > PublicSlug.LevelOrder("C2"));
    }
}
