using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services.Articles;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Services.Seed;

/// <summary>
/// Разделы статей и стартовая статья.
///
/// Зачем сидер, а не «админ сам добавит»: пустой раздел на сайте выглядит
/// сломанным, и первый заход в админку начинается с ручного создания рубрик.
/// Разделы — постоянная структура сайта, а не пользовательский контент, и
/// их отсутствие — это дыра в навигации, а не «ещё не написали».
///
/// Идемпотентно: на повторном старте ничего не дублируется и не перезаписывает
/// правки админа (если он переименовал раздел или дописал статью).
/// </summary>
public class ArticleSeeder
{
    private readonly ApplicationDbContext _context;
    private readonly MarkdownRenderer _renderer;
    private readonly ILogger<ArticleSeeder> _logger;

    public ArticleSeeder(ApplicationDbContext context, MarkdownRenderer renderer, ILogger<ArticleSeeder> logger)
    {
        _context = context;
        _renderer = renderer;
        _logger = logger;
    }

    private static readonly (string Slug, string Name, string Description, int Order)[] Sections =
    {
        ("grammar", "Грамматика", "Времена, артикли, предлоги — с примерами из книг", 1),
        ("vocabulary", "Лексика", "Как учить слова, чтобы они оставались в памяти", 2),
        ("reading", "Чтение", "Как читать книги на английском и не бросать", 3),
        ("practice", "Практика", "Разборы, упражнения, планы занятий", 4),
    };

    public async Task SeedAsync(CancellationToken ct = default)
    {
        var createdSections = 0;
        foreach (var (slug, name, description, order) in Sections)
        {
            // IgnoreQueryFilters + без условия на DeletedAt — намеренно.
            //
            // Раньше здесь стояло `Slug == slug && DeletedAt == null`: удалённый
            // админом раздел не находился, и сидер создавал ВТОРУЮ строку с тем
            // же слагом. Уникальный индекс на слаге в этом случае роняет старт
            // приложения, а без индекса навигация показывает два «Грамматика».
            // Существование строки с таким слагом (живой или удалённой) —
            // достаточное основание ничего не создавать: удаление было
            // решением человека, и сидер его не отменяет.
            var exists = await _context.ArticleSections
                .IgnoreQueryFilters()
                .AnyAsync(s => s.Slug == slug, ct);

            if (exists) continue;

            _context.ArticleSections.Add(new ArticleSection
            {
                Name = name,
                Slug = slug,
                Description = description,
                SortOrder = order,
            });
            createdSections++;
        }

        if (createdSections > 0) await _context.SaveChangesAsync(ct);

        // Стартовая статья: черновик, а не опубликованная. Публиковать от
        // имени админа — значит приписать ему текст, которого он не писал.
        // Черновик виден в админке как образец структуры и ждёт кнопки.
        var starterExists = await _context.Articles
            .IgnoreQueryFilters()
            .AnyAsync(a => a.Slug == "kak-chitat-knigu", ct);

        if (!starterExists)
        {
            var grammarId = await _context.ArticleSections
                .Where(s => s.Slug == "reading" && s.DeletedAt == null)
                .Select(s => (int?)s.Id)
                .FirstOrDefaultAsync(ct);

            var body = """
                # Как читать книгу на английском и не бросать

                Самая частая ошибка — начинать с текста, который интересен, но
                слишком сложен. Через три страницы незнакомых слов становится
                больше, чем знакомых, и книга закрывается навсегда.

                ## Правило пяти незнакомых слов

                На странице должно быть **не больше пяти** незнакомых слов. Если
                больше — это не ваша книга, отложите её на полгода.

                ## Что делать со словами

                1. Выпишите незнакомое слово.
                2. Прочитайте всю главу до конца, не останавливаясь.
                3. Вернитесь и добавьте слова в словарь.

                > Слова в контексте запоминаются втрое лучше, чем списком.
                """;

            _context.Articles.Add(new Article
            {
                Slug = "kak-chitat-knigu",
                Title = "Как читать книгу на английском и не бросать",
                Summary = "Правило пяти незнакомых слов и почему список слов без контекста не работает.",
                BodyMarkdown = body,
                BodyHtml = _renderer.Render(body),
                SectionId = grammarId,
                Status = ArticleStatus.Draft,
            });

            await _context.SaveChangesAsync(ct);
            _logger.LogInformation("Создан черновик стартовой статьи");
        }
    }
}
