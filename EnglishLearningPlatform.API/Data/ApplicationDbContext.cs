using EnglishLearningPlatform.API.Models;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Data;

public class ApplicationDbContext : IdentityDbContext<User>
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    // Identity таблицы добавляются автоматически

    // Наши таблицы
    public DbSet<Word> Words => Set<Word>();
    public DbSet<WordDefinition> WordDefinitions => Set<WordDefinition>();
    public DbSet<UserWord> UserWords => Set<UserWord>();
    public DbSet<Book> Books => Set<Book>();
    public DbSet<Interaction> Interactions => Set<Interaction>();
    public DbSet<WordLevel> WordLevels => Set<WordLevel>();
    public DbSet<WordList> WordLists => Set<WordList>();
    public DbSet<WordListItem> WordListItems => Set<WordListItem>();
    public DbSet<DailyActivity> DailyActivities => Set<DailyActivity>();
    public DbSet<XpEvent> XpEvents => Set<XpEvent>();
    public DbSet<BookKeyWord> BookKeyWords => Set<BookKeyWord>();
    public DbSet<AnalyticsEvent> AnalyticsEvents => Set<AnalyticsEvent>();
    public DbSet<GrammarUnit> GrammarUnits => Set<GrammarUnit>();
    public DbSet<GrammarExercise> GrammarExercises => Set<GrammarExercise>();
    public DbSet<UserGrammarProgress> UserGrammarProgresses => Set<UserGrammarProgress>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // User конфигурация
        builder.Entity<User>()
            .Property(u => u.CreatedAt)
            .HasDefaultValueSql("NOW()");

        // Word конфигурация
        builder.Entity<Word>()
            .HasIndex(w => w.Text)
            .IsUnique();

        // UserWord конфигурация
        builder.Entity<UserWord>()
            .HasIndex(uw => new { uw.UserId, uw.WordId })
            .IsUnique();

        builder.Entity<UserWord>()
            .HasOne(uw => uw.User)
            .WithMany()
            .HasForeignKey(uw => uw.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<UserWord>()
            .HasOne(uw => uw.Word)
            .WithMany(w => w.UserWords)
            .HasForeignKey(uw => uw.WordId)
            .OnDelete(DeleteBehavior.Cascade);

        // Book конфигурация
        builder.Entity<Book>()
            .HasIndex(b => b.Title);

        // Interaction конфигурация
        builder.Entity<Interaction>()
            .HasOne(i => i.User)
            .WithMany()
            .HasForeignKey(i => i.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<Interaction>()
            .HasOne(i => i.Book)
            .WithMany(b => b.Interactions)
            .HasForeignKey(i => i.BookId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Entity<Interaction>()
            .HasOne(i => i.Word)
            .WithMany()
            .HasForeignKey(i => i.WordId)
            .OnDelete(DeleteBehavior.SetNull);

        // WordLevel конфигурация
        builder.Entity<WordLevel>()
            .HasIndex(wl => wl.CefrLevel);

        // WordList конфигурация
        builder.Entity<WordListItem>()
            .HasIndex(wli => new { wli.ListId, wli.FreqRank });

        builder.Entity<WordListItem>()
            .HasOne(wli => wli.List)
            .WithMany(wl => wl.Items)
            .HasForeignKey(wli => wli.ListId)
            .OnDelete(DeleteBehavior.Cascade);

        // DailyActivity конфигурация
        builder.Entity<DailyActivity>()
            .HasIndex(da => new { da.UserId, da.Date })
            .IsUnique();

        builder.Entity<DailyActivity>()
            .HasOne(da => da.User)
            .WithMany()
            .HasForeignKey(da => da.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // XpEvent конфигурация
        builder.Entity<XpEvent>()
            .HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // BookKeyWord конфигурация
        builder.Entity<BookKeyWord>()
            .HasIndex(bk => new { bk.BookId, bk.Page });

        builder.Entity<BookKeyWord>()
            .HasIndex(bk => new { bk.BookId, bk.WordText });

        builder.Entity<BookKeyWord>()
            .HasOne(bk => bk.Book)
            .WithMany()
            .HasForeignKey(bk => bk.BookId)
            .OnDelete(DeleteBehavior.Cascade);

        // AnalyticsEvent конфигурация
        builder.Entity<AnalyticsEvent>()
            .HasIndex(ae => new { ae.UserId, ae.CreatedAt });

        builder.Entity<AnalyticsEvent>()
            .HasIndex(ae => ae.Event);

        builder.Entity<AnalyticsEvent>()
            .HasOne(ae => ae.User)
            .WithMany()
            .HasForeignKey(ae => ae.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Grammar конфигурация
        builder.Entity<GrammarUnit>()
            .HasIndex(gu => gu.Order);

        builder.Entity<GrammarExercise>()
            .HasOne(ge => ge.Unit)
            .WithMany(gu => gu.Exercises)
            .HasForeignKey(ge => ge.UnitId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<UserGrammarProgress>()
            .HasIndex(ugp => new { ugp.UserId, ugp.UnitId })
            .IsUnique();

        builder.Entity<UserGrammarProgress>()
            .HasOne(ugp => ugp.User)
            .WithMany()
            .HasForeignKey(ugp => ugp.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<UserGrammarProgress>()
            .HasOne(ugp => ugp.Unit)
            .WithMany(gu => gu.UserProgresses)
            .HasForeignKey(ugp => ugp.UnitId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}