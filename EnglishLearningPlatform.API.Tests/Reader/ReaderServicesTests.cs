using EnglishLearningPlatform.API.Models.DTOs;
using EnglishLearningPlatform.API.Services.Reader;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests.Reader;

public class ReaderServicesTests
{
    [Fact]
    public async Task Manifest_OpensBookWithoutMovingProgress()
    {
        using var test = ReaderTestContext.Create();
        var pageBefore = test.Book.CurrentPage;

        var manifest = await test.Content.GetManifestAsync("user-1", test.Book.Id);
        await test.Content.GetManifestAsync("user-1", test.Book.Id);

        Assert.NotNull(manifest);
        Assert.Equal(2, manifest!.Manifest.Count);
        Assert.Equal("Chapter One", manifest.Manifest[0].Title);
        Assert.Equal(0, await test.Db.UserBookProgresses.CountAsync());
        Assert.Equal(pageBefore, test.Book.CurrentPage);
        Assert.False(string.IsNullOrWhiteSpace(test.Book.ContentHash));
    }

    [Fact]
    public async Task Chapter_ReturnsSignedImageAndDifficulty()
    {
        using var test = ReaderTestContext.Create();
        var manifest = await test.Content.GetManifestAsync("user-1", test.Book.Id);

        var chapter = await test.Content.GetChapterAsync(
            "user-1", test.Book.Id, manifest!.Manifest[0].Id);

        Assert.NotNull(chapter);
        Assert.Equal(2, chapter!.TotalChapters);
        var image = chapter.Blocks.Single(b => b.Type == ReaderBlockTypes.Image);
        Assert.Contains("/api/reader/assets/", image.AssetUrl);
        Assert.Contains("sig=", image.AssetUrl);
        Assert.True(chapter.Difficulty.TotalWords > 0);
        Assert.Equal(chapter.Difficulty.TotalWords, chapter.Difficulty.KnownWords + chapter.Difficulty.LearningWords + chapter.Difficulty.NewWords);
    }

    [Fact]
    public async Task Position_KeepsMaxPercentWhenReaderGoesBack()
    {
        using var test = ReaderTestContext.Create();
        var manifest = await test.Content.GetManifestAsync("user-1", test.Book.Id);
        var secondChapter = await test.Content.GetChapterAsync(
            "user-1", test.Book.Id, manifest!.Manifest[1].Id);
        var secondSentence = secondChapter!.Blocks.SelectMany(b => b.Sentences).First();

        var forward = await test.Progress.UpdateAsync(
            "user-1",
            test.Book.Id,
            new UpdateReaderPositionRequest
            {
                ChapterId = secondChapter.Id,
                SentenceId = secondSentence.Id,
                CharOffset = 0,
                ActiveSeconds = 0
            });

        Assert.NotNull(forward);
        Assert.True(forward!.MaxPercent > 0);

        var firstChapter = await test.Content.GetChapterAsync(
            "user-1", test.Book.Id, manifest.Manifest[0].Id);
        var firstSentence = firstChapter!.Blocks.SelectMany(b => b.Sentences).First();

        var back = await test.Progress.UpdateAsync(
            "user-1",
            test.Book.Id,
            new UpdateReaderPositionRequest
            {
                ChapterId = firstChapter.Id,
                SentenceId = firstSentence.Id,
                CharOffset = 0,
                ActiveSeconds = 0
            });

        Assert.NotNull(back);
        Assert.True(back!.MaxPercent >= forward.MaxPercent);
        var stored = await test.Db.UserBookProgresses.SingleAsync();
        Assert.Equal(stored.MaxPercent, test.Book.Progress);
        Assert.Equal(firstChapter.Id, stored.ChapterId);
    }

    [Fact]
    public async Task Manifest_AfterPositionReturnsTheSameAnchor()
    {
        using var test = ReaderTestContext.Create();
        var manifest = await test.Content.GetManifestAsync("user-1", test.Book.Id);
        var chapter = await test.Content.GetChapterAsync(
            "user-1", test.Book.Id, manifest!.Manifest[1].Id);
        var sentence = chapter!.Blocks.SelectMany(b => b.Sentences).Last();

        await test.Progress.UpdateAsync(
            "user-1",
            test.Book.Id,
            new UpdateReaderPositionRequest
            {
                ChapterId = chapter.Id,
                SentenceId = sentence.Id,
                CharOffset = 3,
                ActiveSeconds = 0
            });

        var reopened = await test.Content.GetManifestAsync("user-1", test.Book.Id);
        Assert.Equal(chapter.Id, reopened!.Position.ChapterId);
        Assert.Equal(sentence.Id, reopened.Position.SentenceId);
        Assert.Equal(3, reopened.Position.CharOffset);
    }

    [Fact]
    public async Task LegacyPage_IsMappedToAnchorWithoutWritingProgress()
    {
        using var test = ReaderTestContext.Create();
        test.Book.CurrentPage = 2;
        test.Book.Progress = 50;
        await test.Db.SaveChangesAsync();

        var manifest = await test.Content.GetManifestAsync("user-1", test.Book.Id);

        Assert.NotNull(manifest);
        Assert.False(string.IsNullOrWhiteSpace(manifest!.Position.ChapterId));
        Assert.False(string.IsNullOrWhiteSpace(manifest.Position.SentenceId));
        Assert.Equal(50.0, manifest.Position.MaxPercent);
        Assert.Equal(0, await test.Db.UserBookProgresses.CountAsync());
    }

    [Fact]
    public async Task Pocket_IsIdempotentAndPromotesToSrs()
    {
        using var test = ReaderTestContext.Create();
        var manifest = await test.Content.GetManifestAsync("user-1", test.Book.Id);
        var chapter = await test.Content.GetChapterAsync(
            "user-1", test.Book.Id, manifest!.Manifest[0].Id);
        var sentence = chapter!.Blocks.SelectMany(b => b.Sentences)
            .First(s => s.Text.Contains("river", StringComparison.OrdinalIgnoreCase));

        var first = await test.Pocket.UpsertAsync(
            "user-1",
            test.Book.Id,
            new UpsertPocketWordRequest
            {
                Word = "river",
                ChapterId = chapter.Id,
                SentenceId = sentence.Id,
                Translation = "река",
                PartOfSpeech = "noun"
            });
        var second = await test.Pocket.UpsertAsync(
            "user-1",
            test.Book.Id,
            new UpsertPocketWordRequest
            {
                Word = "river",
                ChapterId = chapter.Id,
                SentenceId = sentence.Id,
                Translation = "река",
                PartOfSpeech = "noun"
            });

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.Equal(1, await test.Db.ReaderPocketWords.CountAsync());

        var review = await test.Pocket.GetReviewAsync("user-1", test.Book.Id, chapter.Id, 8);
        Assert.Single(review!.Items);
        Assert.Equal("river", review.Items[0].Word);

        var promoted = await test.Pocket.PromoteAsync("user-1", first!.Id);
        Assert.NotNull(promoted);
        Assert.True(promoted!.Value.Added);
        Assert.Equal(1, await test.Db.UserWords.CountAsync(uw => uw.Word.Text == "river"));

        var afterPromote = await test.Pocket.GetReviewAsync("user-1", test.Book.Id, chapter.Id, 8);
        Assert.Empty(afterPromote!.Items);
    }

    [Fact]
    public async Task Pocket_MarkKnownExcludesWordFromReview()
    {
        using var test = ReaderTestContext.Create();
        var manifest = await test.Content.GetManifestAsync("user-1", test.Book.Id);
        var chapter = await test.Content.GetChapterAsync(
            "user-1", test.Book.Id, manifest!.Manifest[0].Id);
        var sentence = chapter!.Blocks.SelectMany(b => b.Sentences)
            .First(s => s.Text.Contains("letter", StringComparison.OrdinalIgnoreCase));

        var item = await test.Pocket.UpsertAsync(
            "user-1",
            test.Book.Id,
            new UpsertPocketWordRequest
            {
                Word = "letter",
                ChapterId = chapter.Id,
                SentenceId = sentence.Id,
                Translation = "письмо"
            });

        var known = await test.Pocket.MarkKnownAsync("user-1", item!.Id);
        Assert.NotNull(known);
        Assert.True(await test.Db.UserKnownWords.AnyAsync(k => k.Text == "letter"));

        var review = await test.Pocket.GetReviewAsync("user-1", test.Book.Id, chapter.Id, 8);
        Assert.Empty(review!.Items);
    }

    [Fact]
    public void NormalizeWord_HandlesPossessivesAndPunctuation()
    {
        Assert.Equal("alice", ReaderPocketService.NormalizeWord("Alice's"));
        Assert.Equal("don't", ReaderPocketService.NormalizeWord("Don't,"));
        Assert.Equal("hello", ReaderPocketService.NormalizeWord("...hello!"));
        Assert.Equal(string.Empty, ReaderPocketService.NormalizeWord("..."));
        Assert.Equal(string.Empty, ReaderPocketService.NormalizeWord("   "));
        Assert.Equal(string.Empty, ReaderPocketService.NormalizeWord("123"));
    }
}
