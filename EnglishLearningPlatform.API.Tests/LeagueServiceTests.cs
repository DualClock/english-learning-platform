using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests;

public class LeagueServiceTests
{
    private static DateTime CurrentWeekStart()
    {
        var date = DateTime.UtcNow.Date;
        return date.AddDays(-(((int)date.DayOfWeek + 6) % 7));
    }

    private static ApplicationDbContext CreateContext()
    {
        return new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
    }

    private static List<User> AddUsers(ApplicationDbContext context, int count, string league)
    {
        var users = Enumerable.Range(1, count).Select(index => new User
        {
            Id = $"user-{index:00}",
            UserName = $"user-{index:00}@example.com",
            NormalizedUserName = $"USER-{index:00}@EXAMPLE.COM",
            Email = $"user-{index:00}@example.com",
            DisplayName = $"Участник {index}",
            TotalXp = 100,
            League = league,
            NormalizedEmail = $"USER-{index:00}@EXAMPLE.COM"
        }).ToList();

        context.Users.AddRange(users);
        return users;
    }

    private static void AddWeekXp(ApplicationDbContext context, DateTime weekStart, List<User> users)
    {
        // Первый пользователь — лидер, дальше по убыванию.
        for (var index = 0; index < users.Count; index++)
        {
            context.XpEvents.Add(new XpEvent
            {
                UserId = users[index].Id,
                Xp = 100 - index,
                Reason = "test",
                CreatedAt = weekStart.AddDays(2)
            });
        }
    }

    [Fact]
    public async Task ClosedWeek_PromotesTopFive_DemotesBottomFive()
    {
        await using var context = CreateContext();
        var currentWeek = CurrentWeekStart();
        var previousWeek = currentWeek.AddDays(-7);

        var users = AddUsers(context, 12, "silver");
        AddWeekXp(context, previousWeek, users);
        context.LeagueWeekStates.Add(new LeagueWeekState
        {
            Id = 1,
            LastProcessedWeekStart = currentWeek.AddDays(-14)
        });
        await context.SaveChangesAsync();

        var service = new LeagueService(context);
        await service.GetLeaderboardAsync("user-01");
        context.ChangeTracker.Clear();

        var leagues = await context.Users.ToDictionaryAsync(u => u.Id, u => u.League);
        Assert.Equal("gold", leagues["user-01"]);
        Assert.Equal("gold", leagues["user-05"]);
        Assert.Equal("silver", leagues["user-06"]);
        Assert.Equal("bronze", leagues["user-08"]);
        Assert.Equal("bronze", leagues["user-12"]);

        var history = await context.LeagueHistories.ToListAsync();
        Assert.Equal(12, history.Count);
        Assert.Equal("promoted", history.Single(h => h.UserId == "user-01").Outcome);
        Assert.Equal("held", history.Single(h => h.UserId == "user-06").Outcome);
        Assert.Equal("demoted", history.Single(h => h.UserId == "user-12").Outcome);
    }

    [Fact]
    public async Task SmallGroup_IsForming_WithoutMovement()
    {
        await using var context = CreateContext();
        var currentWeek = CurrentWeekStart();
        var previousWeek = currentWeek.AddDays(-7);

        var users = AddUsers(context, 6, "bronze");
        AddWeekXp(context, previousWeek, users);
        context.LeagueWeekStates.Add(new LeagueWeekState
        {
            Id = 1,
            LastProcessedWeekStart = currentWeek.AddDays(-14)
        });
        await context.SaveChangesAsync();

        var service = new LeagueService(context);
        await service.GetLeaderboardAsync("user-01");
        context.ChangeTracker.Clear();

        Assert.All(await context.Users.ToListAsync(), user => Assert.Equal("bronze", user.League));
        Assert.All(await context.LeagueHistories.ToListAsync(), history => Assert.Equal("forming", history.Outcome));
    }

    [Fact]
    public async Task CurrentWeek_ShowsRealGroupAndPromotionZones()
    {
        await using var context = CreateContext();
        var currentWeek = CurrentWeekStart();

        var users = AddUsers(context, 12, "silver");
        AddWeekXp(context, currentWeek, users);
        context.LeagueWeekStates.Add(new LeagueWeekState
        {
            Id = 1,
            LastProcessedWeekStart = currentWeek.AddDays(-7)
        });
        await context.SaveChangesAsync();

        var service = new LeagueService(context);
        var board = await service.GetLeaderboardAsync("user-06");

        Assert.Equal(12, board.Entries.Count);
        Assert.Equal(12, board.Group.Participants);
        Assert.False(board.Group.Forming);
        Assert.True(board.Group.PromotionAvailable);
        Assert.True(board.Group.DemotionAvailable);
        Assert.Equal("silver", board.Group.League);
        Assert.Equal("promotion", board.Entries.Single(e => e.Rank == 1).Zone);
        Assert.Equal("middle", board.Entries.Single(e => e.Rank == 6).Zone);
        Assert.Equal("demotion", board.Entries.Single(e => e.Rank == 12).Zone);
        Assert.True(board.Entries.Single(e => e.Rank == 6).IsMe);
    }

    // ── Порог соревнования: фронт не рендерит лигу на 9 участниках ──────────
    //
    // WeeklyLeague показывает «лигу формируется» с цифрой, но человеку это не
    // соревнование: повышение и вылет на 9 участниках не начисляются, зато
    // таблица выглядит как готовая. Фронт прячет блок целиком, а решает это по
    // числам из API — поэтому обе величины обязаны приезжать наружу и не
    // разъезжаться с правилом, по которому сервер закрывает неделю.

    private static async Task<LeaderboardDto> BoardForGroupSize(int size)
    {
        await using var context = CreateContext();
        var currentWeek = CurrentWeekStart();

        var users = AddUsers(context, size, "silver");
        if (size > 0) AddWeekXp(context, currentWeek, users);

        context.LeagueWeekStates.Add(new LeagueWeekState
        {
            Id = 1,
            LastProcessedWeekStart = currentWeek.AddDays(-7)
        });
        await context.SaveChangesAsync();

        var service = new LeagueService(context);
        return await service.GetLeaderboardAsync(size > 0 ? users[0].Id : "guest-without-xp");
    }

    [Theory]
    [InlineData(9, false)]
    [InlineData(10, true)]
    [InlineData(0, false)]
    public async Task Group_IsConfigurableOnlyFromMinimumCompetitiveGroup(int participants, bool expectedConfigurable)
    {
        var board = await BoardForGroupSize(participants);

        Assert.Equal(participants, board.Group.ParticipantCount);
        Assert.Equal(participants, board.Group.Participants);
        Assert.Equal(LeagueService.MinimumCompetitiveGroup, board.Group.CompetitiveThreshold);

        // Одно слово для фронта: «можно ли показывать соревнование». Это
        // отрицание Forming, а не независимая логика — иначе два экрана начнут
        // показывать разные ответы про одну группу.
        var isConfigurable = board.Group.ParticipantCount >= board.Group.CompetitiveThreshold;

        Assert.Equal(expectedConfigurable, isConfigurable);
        Assert.Equal(expectedConfigurable, !board.Group.Forming);
    }

    /// <summary>
    /// Порог живёт в одном месте: если кто-то поднимет MinimumCompetitiveGroup,
    /// поменяется и DTO, и закрытие недели. Тест ловит правку константы без
    /// правки контракта — иначе фронт остался бы на захардкоженной десятке.
    /// </summary>
    [Fact]
    public async Task Group_ThresholdIsReadFromServiceConstant_NotHardcodedOnClient()
    {
        var board = await BoardForGroupSize(10);

        Assert.Equal(10, board.Group.CompetitiveThreshold);
        Assert.Equal(LeagueService.MinimumCompetitiveGroup, board.Group.CompetitiveThreshold);
        Assert.True(board.Group.ParticipantCount >= board.Group.CompetitiveThreshold);
    }

    /// <summary>
    /// Владелец с нулём XP не должен превращаться в «группу из одного»:
    /// участник — это тот, у кого есть недельный XP. Пустая группа обязана
    /// приезжать как 0 участников, а не 1.
    /// </summary>
    [Fact]
    public async Task EmptyLeaderboard_ReportsZeroParticipants()
    {
        var board = await BoardForGroupSize(0);

        Assert.Equal(0, board.Group.ParticipantCount);
        Assert.Equal(0, board.Group.Participants);
        Assert.True(board.Group.Forming);
        Assert.Empty(board.Entries);
    }
}
