using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// Границы бакетов SRS. Значения взяты не «на глаз», а из формулы
/// <see cref="SrsService.CalculateNextReview"/>: первое успешное повторение даёт
/// 1 день, второе — 6, дальше интервал × easeFactor (минимальный EF — 1.3,
/// значит любое слово рано или поздно переползает из «8–30» в «&gt;30»).
/// Поэтому проверяются ровно пары «на границе / на день за границей».
/// </summary>
public class SrsBreakdownTests
{
    private static ApplicationDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase("srs-breakdown-" + Guid.NewGuid().ToString("N"))
            .Options);

    private static User User(string id = "user-a") =>
        new() { Id = id, UserName = id, Email = $"{id}@example.com" };

    private static UserWord Word(
        string userId,
        int intervalDays,
        int lapses = 0,
        int intervalMinutes = 0,
        DateTime? nextReviewDate = null) =>
        new()
        {
            UserId = userId,
            Interval = intervalDays,
            IntervalMinutes = intervalMinutes,
            Lapses = lapses,
            EaseFactor = 2.5,
            RepetitionCount = intervalDays > 0 ? 1 : 0,
            IsLeech = lapses >= SrsService.LeechThreshold,
            NextReviewDate = nextReviewDate,
            LastReviewedAt = nextReviewDate == null ? null : DateTime.UtcNow.AddDays(-1)
        };

    /// <summary>Пользователь без часового пояса = UTC, тогда «завтра» — это UTC-сутки.</summary>
    private static async Task<(ApplicationDbContext Context, SrsBreakdownService Service)> CreateAsync(
        params UserWord[] words)
    {
        var context = CreateContext();
        context.Users.Add(User());
        context.UserWords.AddRange(words);
        await context.SaveChangesAsync();
        return (context, new SrsBreakdownService(context));
    }

    [Theory]
    [InlineData(0, "learning")]  // learning step: срок ещё не назначен
    [InlineData(1, "short")]     // первое повторение: ровно 1 день — это уже не learning
    [InlineData(7, "short")]     // конец short
    [InlineData(8, "medium")]    // начало medium
    [InlineData(30, "medium")]   // конец medium
    [InlineData(31, "long")]     // начало long
    public async Task Bucket_Boundaries_MatchInterval(int intervalDays, string expectedBucket)
    {
        var (context, service) = await CreateAsync(Word("user-a", intervalDays));
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(expectedBucket, SrsBreakdownService.BucketOf(intervalDays));
        Assert.Equal(1, breakdown.Buckets[expectedBucket]);
        Assert.Equal(expectedBucket, breakdown.Buckets.First(pair => pair.Value == 1).Key);
    }

    [Fact]
    public async Task LearningStep_WithMinutes_StaysLearning()
    {
        // «Забыл» ставит IntervalDays = 0 и StepMinutes = 10: слово вернётся сегодня
        // же, поэтому оно не в short, хотя минуты больше нуля.
        var (context, service) = await CreateAsync(
            Word("user-a", intervalDays: 0, intervalMinutes: SrsService.LearningStepMinutes));
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(1, breakdown.Learning);
        Assert.Equal(0, breakdown.Short);
        Assert.Equal(1, breakdown.TotalWords);
    }

    [Theory]
    [InlineData(4, 0)]
    [InlineData(4, 3)]
    [InlineData(4, 90)]
    [InlineData(7, 12)]
    public async Task Leech_CountedByLapses_RegardlessOfInterval(int lapses, int intervalDays)
    {
        // Leech — это про срывы, а не про интервал: лееч с длинным интервалом
        // (данные до сброса расписания) тоже должен попасть в счётчик.
        var (context, service) = await CreateAsync(Word("user-a", intervalDays, lapses: lapses));
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(1, breakdown.Leech);
        Assert.Equal(1, breakdown.TotalWords);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    public async Task Leech_BelowThreshold_NotCounted(int lapses)
    {
        var (context, service) = await CreateAsync(Word("user-a", intervalDays: 1, lapses: lapses));
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(0, breakdown.Leech);
        Assert.Equal(1, breakdown.TotalWords);
    }

    [Fact]
    public async Task Leech_Threshold_IsFourLapses()
    {
        // Ровно порог из SrsService: 3 срыва — ещё не лееч, 4 — уже лееч.
        var (context, service) = await CreateAsync(
            Word("user-a", 2, lapses: 3),
            Word("user-a", 2, lapses: 4));
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(1, breakdown.Leech);
        Assert.Equal(2, breakdown.TotalWords);
    }

    [Fact]
    public async Task EmptyUser_ReturnsZerosWithoutDivisionByZero()
    {
        var (context, service) = await CreateAsync();
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(0, breakdown.TotalWords);
        Assert.Equal(0, breakdown.Learning);
        Assert.Equal(0, breakdown.Short);
        Assert.Equal(0, breakdown.Medium);
        Assert.Equal(0, breakdown.Long);
        Assert.Equal(0, breakdown.Leech);
        Assert.Equal(0, breakdown.ReliableCount);
        Assert.Equal(0, breakdown.DueToday);
        Assert.Equal(0, breakdown.DueTomorrow);
        Assert.Equal(4, breakdown.Buckets.Count);
        Assert.All(breakdown.Buckets.Values, value => Assert.Equal(0, value));
    }

    [Fact]
    public async Task UnknownUser_ReturnsZerosInsteadOfThrowing()
    {
        // Протухшая кука или удалённый аккаунт не должны валить страницу прогресса
        // пятисоткой: пустой агрегат честнее.
        var context = CreateContext();
        await using var _ = context;

        var breakdown = await new SrsBreakdownService(context).GetAsync("no-such-user");

        Assert.Equal(0, breakdown.TotalWords);
        Assert.Equal(SrsBreakdownService.ReliableIntervalDays, breakdown.ReliableIntervalDays);
    }

    [Fact]
    public async Task OtherUsersWords_NotCounted()
    {
        var context = CreateContext();
        await using var _ = context;
        context.Users.AddRange(User("user-a"), User("user-b"));
        context.UserWords.AddRange(
            Word("user-a", intervalDays: 10),
            Word("user-b", intervalDays: 10),
            Word("user-b", intervalDays: 40));
        await context.SaveChangesAsync();

        var breakdown = await new SrsBreakdownService(context).GetAsync("user-a");

        Assert.Equal(1, breakdown.TotalWords);
        Assert.Equal(0, breakdown.Long);
    }

    [Fact]
    public async Task DueTomorrow_DoesNotOverlapDueToday()
    {
        var now = DateTime.UtcNow;
        var (context, service) = await CreateAsync(
            Word("user-a", intervalDays: 1, nextReviewDate: now.AddHours(-2)),   // просрочено
            Word("user-a", intervalDays: 1, nextReviewDate: now.AddMinutes(-1)), // тоже dueToday
            Word("user-a", intervalDays: 6, nextReviewDate: now.AddHours(5)),    // завтра (UTC+0)
            Word("user-a", intervalDays: 6, nextReviewDate: now.AddDays(3)));    // ни туда, ни туда
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(2, breakdown.DueToday);
        Assert.Equal(1, breakdown.DueTomorrow);
        Assert.True(breakdown.DueToday + breakdown.DueTomorrow <= breakdown.TotalWords);
    }

    [Fact]
    public async Task DueTomorrow_IncludesRestOfToday()
    {
        // Слово со сроком «через 4 часа» ещё не просрочено, но сегодня же и вернётся.
        // Для прогноза «сколько вернётся завтра» оно бесполезно — счётчик его не берёт,
        // а вот всё, что после текущего момента и до конца суток, — берёт.
        var now = DateTime.UtcNow;
        var (context, service) = await CreateAsync(
            Word("user-a", intervalDays: 1, nextReviewDate: now.AddHours(2)),
            Word("user-a", intervalDays: 1, nextReviewDate: now.AddDays(2)));
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(0, breakdown.DueToday);
        Assert.Equal(1, breakdown.DueTomorrow);
    }

    [Fact]
    public async Task NewWordWithoutSchedule_IsCountedInBucketsButNotInForecast()
    {
        // Слово добавлено в словарь, но ещё не показано ни разу: оно ждёт своей
        // очереди новых, а не конкретной даты. Иначе «сегодня» раздулось бы
        // на весь словарь.
        var (context, service) = await CreateAsync(Word("user-a", intervalDays: 0));
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(1, breakdown.TotalWords);
        Assert.Equal(1, breakdown.Learning);
        Assert.Equal(0, breakdown.DueToday);
        Assert.Equal(0, breakdown.DueTomorrow);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(21, false)]
    [InlineData(22, true)]
    [InlineData(365, true)]
    public async Task Reliable_IsIntervalAbove21Days(int intervalDays, bool reliable)
    {
        // 21 день — ровно три недели, верхняя граница «ещё повторяю часто».
        // 22 и дальше — слово вернётся не раньше чем через три недели.
        var (context, service) = await CreateAsync(Word("user-a", intervalDays));
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(reliable ? 1 : 0, breakdown.ReliableCount);
        Assert.Equal(21, SrsBreakdownService.ReliableIntervalDays);
    }

    [Fact]
    public async Task TotalWords_IsSumOfIntervalBuckets_AndLeechIsSubset()
    {
        var (context, service) = await CreateAsync(
            Word("user-a", 0),
            Word("user-a", 3),
            Word("user-a", 12),
            Word("user-a", 60),
            Word("user-a", 2, lapses: 5));
        await using var _ = context;

        var breakdown = await service.GetAsync("user-a");

        Assert.Equal(5, breakdown.TotalWords);
        Assert.Equal(1, breakdown.Learning);
        Assert.Equal(2, breakdown.Short);   // 3 дня и лееч с интервалом 2
        Assert.Equal(1, breakdown.Medium);
        Assert.Equal(1, breakdown.Long);
        Assert.Equal(1, breakdown.Leech);
        Assert.Equal(
            breakdown.TotalWords,
            breakdown.Learning + breakdown.Short + breakdown.Medium + breakdown.Long);
    }

    [Fact]
    public void BucketsFollowSrsFormula()
    {
        // Главная связка с алгоритмом: первый успешный ответ даёт 1 день,
        // значит слово попадает в «1–7», а не в «learning». Второй — 6 дней,
        // всё ещё «1–7»; третий (6 × 2.5 = 15) — уже «8–30»; «Забыл» — снова learning.
        var first = SrsService.CalculateNextReview(4, 0, 0, 2.5, 0, 0, applyFuzz: false);
        var second = SrsService.CalculateNextReview(
            4, first.IntervalDays, 0, first.EaseFactor, first.Repetitions, 0, applyFuzz: false);
        var third = SrsService.CalculateNextReview(
            4, second.IntervalDays, 0, second.EaseFactor, second.Repetitions, 0, applyFuzz: false);
        var failed = SrsService.CalculateNextReview(
            1, third.IntervalDays, 0, third.EaseFactor, third.Repetitions, 0, applyFuzz: false);

        Assert.Equal(1, first.IntervalDays);
        Assert.Equal("short", SrsBreakdownService.BucketOf(first.IntervalDays));
        Assert.Equal(6, second.IntervalDays);
        Assert.Equal("short", SrsBreakdownService.BucketOf(second.IntervalDays));
        Assert.Equal(15, third.IntervalDays);
        Assert.Equal("medium", SrsBreakdownService.BucketOf(third.IntervalDays));
        Assert.Equal(0, failed.IntervalDays);
        Assert.Equal("learning", SrsBreakdownService.BucketOf(failed.IntervalDays));
    }
}
