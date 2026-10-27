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
    public DbSet<GuestAnalyticsEvent> GuestAnalyticsEvents => Set<GuestAnalyticsEvent>();
    public DbSet<GrammarUnit> GrammarUnits => Set<GrammarUnit>();
    public DbSet<GrammarExercise> GrammarExercises => Set<GrammarExercise>();
    public DbSet<UserGrammarProgress> UserGrammarProgresses => Set<UserGrammarProgress>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<CategoryWord> CategoryWords => Set<CategoryWord>();
    public DbSet<UserCategoryWordProgress> UserCategoryWordProgresses => Set<UserCategoryWordProgress>();
    public DbSet<UserAchievement> UserAchievements => Set<UserAchievement>();
    public DbSet<ReviewLog> ReviewLogs => Set<ReviewLog>();
    public DbSet<EmailMessage> EmailMessages => Set<EmailMessage>();
    public DbSet<AiUsageLog> AiUsageLogs => Set<AiUsageLog>();
    public DbSet<UserErrorBankEntry> UserErrorBankEntries => Set<UserErrorBankEntry>();
    public DbSet<UserKnownWord> UserKnownWords => Set<UserKnownWord>();
    public DbSet<BookBookmark> BookBookmarks => Set<BookBookmark>();
    public DbSet<BookContentSnapshot> BookContentSnapshots => Set<BookContentSnapshot>();
    public DbSet<UserBookProgress> UserBookProgresses => Set<UserBookProgress>();
    public DbSet<ReaderPocketWord> ReaderPocketWords => Set<ReaderPocketWord>();
    public DbSet<SpeechUsage> SpeechUsages => Set<SpeechUsage>();
    public DbSet<LeagueWeekState> LeagueWeekStates => Set<LeagueWeekState>();
    public DbSet<LeagueHistory> LeagueHistories => Set<LeagueHistory>();

    // CMS: новости из фидов, статьи и интересы пользователей.
    public DbSet<NewsItem> NewsItems => Set<NewsItem>();
    public DbSet<Article> Articles => Set<Article>();
    public DbSet<ArticleSection> ArticleSections => Set<ArticleSection>();
    public DbSet<ArticleRevision> ArticleRevisions => Set<ArticleRevision>();
    public DbSet<UserInterest> UserInterests => Set<UserInterest>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<LeagueHistory>()
            .HasIndex(h => new { h.UserId, h.WeekStart })
            .IsUnique();

        // Квоты и учёт токенов: выборка usage за день по пользователю
        builder.Entity<AiUsageLog>()
            .HasIndex(l => new { l.UserId, l.CreatedAt });

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

        // Очередь повторения (SrsService) фильтрует по пользователю и дате следующего показа
        builder.Entity<UserWord>()
            .HasIndex(uw => new { uw.UserId, uw.NextReviewDate });

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

        // Книги, загруженные пользователем (библиотека, достижения)
        builder.Entity<Book>()
            .HasIndex(b => b.UploadedByUserId);

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

        // Недельная лига читает XP за интервал по всем пользователям.
        builder.Entity<XpEvent>()
            .HasIndex(x => x.CreatedAt);

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

        // Активационное событие «первая открытая глава» считается один раз на
        // человека. Проверка в контроллере вежливая (она отвечает 200 и ничего не
        // пишет), но два параллельных запроса могут пройти её одновременно —
        // поэтому правило держит база: частичный уникальный индекс покрывает
        // только эту строку события и не мешает остальной аналитике.
        // Кавычки в фильтре стандартные для Postgres и SQLite, тестовый
        // провайдер получает корректный DDL.
        builder.Entity<AnalyticsEvent>()
            .HasIndex(ae => new { ae.UserId, ae.Event })
            .HasDatabaseName("IX_AnalyticsEvents_FirstChapterPerUser")
            .HasFilter("\"Event\" = 'chapter_opened_first'")
            .IsUnique();

        // Аналитика по периодам: глобальные срезы по дате
        builder.Entity<AnalyticsEvent>()
            .HasIndex(ae => ae.CreatedAt);

        builder.Entity<AnalyticsEvent>()
            .HasOne(ae => ae.User)
            .WithMany()
            .HasForeignKey(ae => ae.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // GuestAnalyticsEvent конфигурация (W2.4).
        // Единственный внешний ключ здесь — тот, которого нет: гостевые события
        // не привязаны к пользователю, поэтому таблица физически не может
        // содержать PII даже при баге в коде.
        builder.Entity<GuestAnalyticsEvent>()
            .Property(g => g.IpHash)
            .HasMaxLength(64);

        builder.Entity<GuestAnalyticsEvent>()
            .Property(g => g.DedupeKey)
            .HasMaxLength(64);

        // Антидубль: одна и та же отправка (тот же nonce клиента) не может
        // создать вторую строку. Вежливая проверка в контроллере закрывает
        // обычный повтор, этот индекс — гонку двух параллельных повторов, ровно
        // как частичный индекс у chapter_opened_first.
        builder.Entity<GuestAnalyticsEvent>()
            .HasIndex(g => new { g.Event, g.DedupeKey })
            .HasDatabaseName("IX_GuestAnalyticsEvents_Event_DedupeKey")
            .IsUnique();

        // Выгрузка воронки: срез «событие × сутки» — то, чем живёт /acquisition.
        builder.Entity<GuestAnalyticsEvent>()
            .HasIndex(g => new { g.Event, g.Day })
            .HasDatabaseName("IX_GuestAnalyticsEvents_Event_Day");

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

        // Category конфигурация
        // Уникальность слага — только среди живых категорий. Софт-удалённая
        // строка слагов не занимает: иначе админ, удаливший категорию, не
        // сможет создать её заново с тем же адресом — 500 от нарушения
        // индекса вместо понятной работы. Частичный индекс покрывает только
        // неудалённые строки; восстановление конфликтующей категории проверяет
        // контроллер.
        builder.Entity<Category>()
            .HasIndex(c => c.Slug)
            .IsUnique()
            .HasDatabaseName("IX_Categories_Slug_Active")
            .HasFilter("\"DeletedAt\" IS NULL");

        // Та же логика, что у слага категории: удалённое слово не занимает
        // пару (CategoryId, English), иначе повторно добавить его нельзя.
        builder.Entity<CategoryWord>()
            .HasIndex(cw => new { cw.CategoryId, cw.English })
            .IsUnique()
            .HasDatabaseName("IX_CategoryWords_Category_English_Active")
            .HasFilter("\"DeletedAt\" IS NULL");

        // RESTRICT, а не Cascade: удаление слова из категории не имеет права
        // уносить прогресс пользователей (UserCategoryWordProgress). До CMS-1
        // здесь стоял Cascade — один DELETE CategoryWords стирал «выучено» у
        // всех сразу, и восстановить это было нельзя: строка прогресса не
        // содержит ни даты, ни истории.
        //
        // Удаление теперь идёт через DeletedAt (см. HasQueryFilter ниже), а
        // физический DELETE разрешён только после того, как прогресс по слову
        // осознанно вычищен — и тогда база его не пропустит молча.
        builder.Entity<CategoryWord>()
            .HasOne(cw => cw.Category)
            .WithMany(c => c.Words)
            .HasForeignKey(cw => cw.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Entity<UserCategoryWordProgress>()
            .HasIndex(p => new { p.UserId, p.CategoryWordId })
            .IsUnique();

        builder.Entity<UserCategoryWordProgress>()
            .HasOne(p => p.User)
            .WithMany()
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Restrict и здесь: строка прогресса принадлежит пользователю и
        // переживает удаление категорийного слова.
        builder.Entity<UserCategoryWordProgress>()
            .HasOne(p => p.CategoryWord)
            .WithMany(cw => cw.UserProgresses)
            .HasForeignKey(p => p.CategoryWordId)
            .OnDelete(DeleteBehavior.Restrict);

        // Мягкое удаление контента. Фильтр стоит на каждой сущности отдельно,
        // а не через общий generic-обход: EF требует явного
        // HasQueryFilter на конкретном типе, и собрать его в цикле нельзя без
        // рефлексии по модели.
        //
        // IgnoreQueryFilters() нужен админке (посмотреть удалённое) и уборке;
        // кешированная выдача каталога этого фильтра не имеет, поэтому при
        // удалении её кэш инвалидируется явно.
        builder.Entity<Word>().HasQueryFilter(w => w.DeletedAt == null);
        builder.Entity<Category>().HasQueryFilter(c => c.DeletedAt == null);
        builder.Entity<Book>().HasQueryFilter(b => b.DeletedAt == null);

        // У CategoryWord фильтра НЕТ — сознательно.
        //
        // Почему не так, как у остальных: у пользователя есть строка
        // UserCategoryWordProgress с обязательным FK на CategoryWord. Если
        // спрятать CategoryWord фильтром, EF предупреждает ровно о том, что
        // произойдёт: запросы, которые идут от прогресса к слову
        // (Include/навигация), начнут получать null там, где связь в базе
        // цела. Вдобавок FindAsync и AnyAsync по удалённому слову начнут
        // врать одинаково — «слова нет» вместо «слово удалено», и любой код
        // восстановления потеряет возможность его найти.
        //
        // Вместо фильтра удалённое слово отсекается там, где выдача строится
        // от Category.Words (GET /api/categories/{slug}/words) — явным
        // `.Where(cw => cw.DeletedAt == null)`. Прогресс пользователя при этом
        // остаётся читаемым, а категория в каталоге продолжает жить.

        // Lookup удалённого: индекс по DeletedAt, чтобы фильтр не превращался
        // в полный скан на больших таблицах.
        builder.Entity<Word>().HasIndex(w => w.DeletedAt);
        builder.Entity<Category>().HasIndex(c => c.DeletedAt);
        builder.Entity<CategoryWord>().HasIndex(cw => cw.DeletedAt);
        builder.Entity<Book>().HasIndex(b => b.DeletedAt);

        // Достижения: один код на пользователя
        builder.Entity<UserAchievement>()
            .HasIndex(a => new { a.UserId, a.Code })
            .IsUnique();

        builder.Entity<UserAchievement>()
            .HasOne(a => a.User)
            .WithMany()
            .HasForeignKey(a => a.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // История повторений
        builder.Entity<ReviewLog>()
            .HasIndex(r => new { r.UserId, r.ReviewedAt });

        builder.Entity<ReviewLog>()
            .HasIndex(r => new { r.WordId, r.ReviewedAt });

        builder.Entity<ReviewLog>()
            .HasOne(r => r.User)
            .WithMany()
            .HasForeignKey(r => r.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Журнал писем: ищем последнее напоминание пользователя
        builder.Entity<EmailMessage>()
            .HasIndex(m => new { m.UserId, m.Kind, m.CreatedAt });

        builder.Entity<EmailMessage>()
            .HasIndex(m => m.CreatedAt);

        // Банк ошибок: выборка нерешённых записей пользователя
        builder.Entity<UserErrorBankEntry>()
            .HasIndex(e => new { e.UserId, e.ResolvedAt });

        builder.Entity<UserErrorBankEntry>()
            .HasOne(e => e.User)
            .WithMany()
            .HasForeignKey(e => e.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Известные слова читалки: одно слово на пользователя
        builder.Entity<UserKnownWord>()
            .HasIndex(k => new { k.UserId, k.Text })
            .IsUnique();

        builder.Entity<UserKnownWord>()
            .HasOne(k => k.User)
            .WithMany()
            .HasForeignKey(k => k.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Закладки: одна закладка на страницу книги у пользователя (старый формат)
        builder.Entity<BookBookmark>()
            .HasIndex(b => new { b.BookId, b.UserId, b.Page })
            .IsUnique();

        // Новый формат: одна закладка на предложение. NULL в Page/ChapterId
        // Postgres не считает конфликтом, поэтому старые строки не мешают.
        builder.Entity<BookBookmark>()
            .HasIndex(b => new { b.BookId, b.UserId, b.ChapterId, b.SentenceId })
            .IsUnique();

        builder.Entity<BookBookmark>()
            .HasOne(b => b.Book)
            .WithMany()
            .HasForeignKey(b => b.BookId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<BookBookmark>()
            .HasOne(b => b.User)
            .WithMany()
            .HasForeignKey(b => b.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Снимок книги: один разбор на хэш содержимого и версию парсера.
        builder.Entity<BookContentSnapshot>()
            .HasIndex(s => new { s.ContentHash, s.ParserVersion })
            .IsUnique();

        builder.Entity<Book>()
            .HasOne(b => b.ContentSnapshot)
            .WithMany()
            .HasForeignKey(b => b.ContentSnapshotId)
            .OnDelete(DeleteBehavior.SetNull);

        // Точка чтения: одна на пользователя и книгу.
        builder.Entity<UserBookProgress>()
            .HasIndex(p => new { p.UserId, p.BookId })
            .IsUnique();

        builder.Entity<UserBookProgress>()
            .HasOne(p => p.Book)
            .WithMany()
            .HasForeignKey(p => p.BookId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<UserBookProgress>()
            .HasOne(p => p.User)
            .WithMany()
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Карман чтения: слово уникально в пределах книги пользователя.
        builder.Entity<ReaderPocketWord>()
            .HasIndex(p => new { p.UserId, p.BookId, p.NormalizedWord })
            .IsUnique();

        builder.Entity<ReaderPocketWord>()
            .HasIndex(p => new { p.UserId, p.ChapterId });

        builder.Entity<ReaderPocketWord>()
            .HasIndex(p => new { p.UserId, p.LastSeenAt });

        builder.Entity<ReaderPocketWord>()
            .HasOne(p => p.Book)
            .WithMany()
            .HasForeignKey(p => p.BookId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<ReaderPocketWord>()
            .HasOne(p => p.User)
            .WithMany()
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Расход Azure Speech: одна строка на месяц, Period — ключ.
        builder.Entity<SpeechUsage>()
            .HasKey(u => u.Period);

        // ─────────────────────────────────────────── CMS: новости и статьи

        // Дедупликация новостей. Уникальный индекс, а не проверка в коде:
        // два параллельных запуска фетчера (ручной «Обновить сейчас» поверх
        // фонового) иначе создадут по строке на каждый материал.
        builder.Entity<NewsItem>()
            .HasIndex(n => n.ExternalId)
            .IsUnique()
            .HasDatabaseName("IX_NewsItems_ExternalId");

        // Персональная выдача: свежие по уровню, только видимые.
        builder.Entity<NewsItem>()
            .HasIndex(n => new { n.IsHidden, n.PublishedAt })
            .HasDatabaseName("IX_NewsItems_Visibility_PublishedAt");

        builder.Entity<NewsItem>()
            .HasIndex(n => new { n.Level, n.PublishedAt })
            .HasDatabaseName("IX_NewsItems_Level_PublishedAt");

        // Уборка старых новостей идёт по FetchedAt.
        builder.Entity<NewsItem>()
            .HasIndex(n => n.FetchedAt);

        // Слаг раздела уникален среди живых — та же логика, что у категорий:
        // удалённый раздел не должен блокировать создание одноимённого.
        builder.Entity<ArticleSection>()
            .HasIndex(s => s.Slug)
            .IsUnique()
            .HasDatabaseName("IX_ArticleSections_Slug_Active")
            .HasFilter("\"DeletedAt\" IS NULL");

        builder.Entity<ArticleSection>()
            .HasQueryFilter(s => s.DeletedAt == null);

        // Слаг статьи тоже уникален только среди живых.
        builder.Entity<Article>()
            .HasIndex(a => a.Slug)
            .IsUnique()
            .HasDatabaseName("IX_Articles_Slug_Active")
            .HasFilter("\"DeletedAt\" IS NULL");

        // Лента статей: опубликованные по дате публикации.
        builder.Entity<Article>()
            .HasIndex(a => new { a.Status, a.PublishedAt })
            .HasDatabaseName("IX_Articles_Status_PublishedAt");

        builder.Entity<Article>()
            .HasQueryFilter(a => a.DeletedAt == null);

        // Удаление раздела не уносит статьи: они переезжают в «без раздела»
        // (SetNull), и их можно разложить заново. Cascade стёр бы тексты.
        builder.Entity<Article>()
            .HasOne(a => a.Section)
            .WithMany(s => s.Articles)
            .HasForeignKey(a => a.SectionId)
            .OnDelete(DeleteBehavior.SetNull);

        // Ревизии живут и умирают вместе со статьёй: отдельной ценности без
        // неё нет, а сироты в базе копятся.
        builder.Entity<ArticleRevision>()
            .HasOne(r => r.Article)
            .WithMany(a => a.Revisions)
            .HasForeignKey(r => r.ArticleId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<ArticleRevision>()
            .HasIndex(r => new { r.ArticleId, r.Revision })
            .IsUnique()
            .HasDatabaseName("IX_ArticleRevisions_Article_Version");

        // Один интерес — одна строка на пользователя.
        builder.Entity<UserInterest>()
            .HasIndex(i => new { i.UserId, i.Interest })
            .IsUnique()
            .HasDatabaseName("IX_UserInterests_User_Interest");

        builder.Entity<UserInterest>()
            .HasOne(i => i.User)
            .WithMany()
            .HasForeignKey(i => i.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Обратная выборка: «кто интересуется наукой» — для будущей рассылки.
        builder.Entity<UserInterest>()
            .HasIndex(i => i.Interest);
    }
}