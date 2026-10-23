using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// Фоновая чистка гостевых событий (W4.1, privacy-гигиена).
///
/// Тестируется сам метод прохода, а не таймер: интервал — деталь запуска
/// процесса, а порог хранения и границы удаления — предмет контракта.
///
/// Проверяется ровно то, за что мы отвечаем текстом на /privacy: older than
/// GuestRetentionDays уходит, свежее остаётся, проход можно повторять, и
/// некорректное значение конфига не превращается в «ничего не удаляем».
/// </summary>
public class GuestAnalyticsCleanupTests
{
    private static ApplicationDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static GuestAnalyticsCleanupService CreateService(
        ApplicationDbContext context,
        string? retentionDays)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Analytics:GuestRetentionDays"] = retentionDays
            })
            .Build();

        return new GuestAnalyticsCleanupService(
            context,
            NullLogger<GuestAnalyticsCleanupService>.Instance,
            configuration);
    }

    private static void Guest(ApplicationDbContext context, DateOnly day, string dedupeKey)
    {
        context.GuestAnalyticsEvents.Add(new GuestAnalyticsEvent
        {
            Event = "placement_test_started",
            Day = day,
            Hour = 9,
            IpHash = "ip-hash",
            DedupeKey = dedupeKey
        });
    }

    [Fact]
    public async Task RunOnce_RemovesOnlyRowsOlderThanTheThreshold()
    {
        using var context = CreateContext();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        Guest(context, today, "fresh-1");
        Guest(context, today.AddDays(-29), "fresh-2");
        Guest(context, today.AddDays(-30), "edge");
        Guest(context, today.AddDays(-31), "stale");
        Guest(context, today.AddDays(-90), "very-stale");
        await context.SaveChangesAsync();

        var deleted = await CreateService(context, null).RunOnceAsync();

        Assert.Equal(2, deleted);

        var rest = await context.GuestAnalyticsEvents.ToListAsync();
        Assert.All(rest, g => Assert.True(g.Day >= today.AddDays(-30), "осталась строка старше порога"));
        Assert.Contains(rest, g => g.Day == today);
        Assert.Contains(rest, g => g.Day == today.AddDays(-29));
        // Ровно на границе (сегодня − 30) строка живёт: «старше 30 суток» —
        // это строго раньше, а не «не меньше».
        Assert.Contains(rest, g => g.Day == today.AddDays(-30));
        Assert.DoesNotContain(rest, g => g.Day == today.AddDays(-31));
    }

    [Fact]
    public async Task RunOnce_HonoursConfiguredRetentionDays()
    {
        using var context = CreateContext();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        Guest(context, today.AddDays(-6), "six");
        Guest(context, today.AddDays(-8), "eight");
        await context.SaveChangesAsync();

        var service = CreateService(context, "7");
        Assert.Equal(7, service.RetentionDays);

        Assert.Equal(1, await service.RunOnceAsync());
        Assert.Single(await context.GuestAnalyticsEvents.ToListAsync());
    }

    [Theory]
    [InlineData(null, GuestAnalyticsCleanupService.DefaultRetentionDays)]
    [InlineData("", GuestAnalyticsCleanupService.DefaultRetentionDays)]
    [InlineData("abc", GuestAnalyticsCleanupService.DefaultRetentionDays)]
    [InlineData("0", GuestAnalyticsCleanupService.DefaultRetentionDays)]
    [InlineData("-5", GuestAnalyticsCleanupService.DefaultRetentionDays)]
    [InlineData("45", 45)]
    public void RetentionDays_InvalidValue_FallsBackToDefault(string? raw, int expected)
    {
        // Ноль = не «очистка выключена»: выключенная гигиена противоречит
        // обещанному сроку хранения, поэтому мусор даёт дефолт.
        Assert.Equal(expected, GuestAnalyticsCleanupService.ResolveRetentionDays(raw));
        Assert.Equal(30, GuestAnalyticsCleanupService.DefaultRetentionDays);
    }

    [Fact]
    public async Task RunOnce_KeepsDeletingInBatchesUntilNothingOlderRemains()
    {
        // Больше одной пачки: проверка, что цикл не останавливается после
        // первого Take(BatchSize) и не зовёт базу лишний раз.
        using var context = CreateContext();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var total = GuestAnalyticsCleanupService.BatchSize * 2 + 7;

        for (var i = 0; i < total; i++)
        {
            Guest(context, today.AddDays(-40), $"old-{i}");
        }
        Guest(context, today, "fresh");
        await context.SaveChangesAsync();

        var deleted = await CreateService(context, null).RunOnceAsync();

        Assert.Equal(total, deleted);
        Assert.Single(await context.GuestAnalyticsEvents.ToListAsync());
    }

    [Fact]
    public async Task RunOnce_OnEmptyTable_ReturnsZeroAndDoesNotThrow()
    {
        using var context = CreateContext();

        Assert.Equal(0, await CreateService(context, null).RunOnceAsync());
    }

    [Fact]
    public async Task RunOnce_IsIdempotent()
    {
        using var context = CreateContext();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        Guest(context, today.AddDays(-45), "old");
        await context.SaveChangesAsync();

        var service = CreateService(context, null);
        Assert.Equal(1, await service.RunOnceAsync());
        Assert.Equal(0, await service.RunOnceAsync());
    }

    [Fact]
    public async Task RunOnce_KeepsRowsOfOtherEvents()
    {
        // Чистка не должна уметь выбирать «что-то ещё»: условие удаления —
        // только сутки, имя события в него не входит.
        using var context = CreateContext();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        context.GuestAnalyticsEvents.Add(new GuestAnalyticsEvent
        {
            Event = "cohort_page_viewed",
            Day = today.AddDays(-60),
            Hour = 3,
            IpHash = "ip-hash",
            DedupeKey = "cohort-old"
        });
        Guest(context, today.AddDays(-60), "started-old");
        await context.SaveChangesAsync();

        Assert.Equal(2, await CreateService(context, null).RunOnceAsync());
        Assert.Empty(await context.GuestAnalyticsEvents.ToListAsync());
    }
}
