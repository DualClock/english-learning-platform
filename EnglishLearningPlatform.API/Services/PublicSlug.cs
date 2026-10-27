using System.Text;
using System.Text.RegularExpressions;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Единственное место на бэкенде, где из названия книги получается публичный
/// адрес (/library/&lt;slug&gt;). Считается один раз и здесь, потому что слаг
/// попадает и в выдачу API, и в sitemap, и в canonical: две функции-двойника
/// разъехались бы за неделю, и поисковик увидел бы два разных адреса на одну
/// книгу.
///
/// Правила (детерминированные, без случайности и без состояния):
///  1. диакритика снимается через NFKD — «Bronteё» → "bronteë"-подобные буквы
///     всё равно оставляем латиницей, а «Wuthering» не зависит от акцента;
///  2. апостроф и мягкий знак ВЫБРАСЫВАЮТСЯ, а не превращаются в дефис:
///     «Alice's Adventures in Wonderland» → "alices-adventures-in-wonderland";
///  3. «&amp;» читается как слово: «Lost Kitten &amp; Friends» → "lost-kitten-and-friends"
///     — так адрес остаётся читаемым для человека и для краулера;
///  4. остаются только [a-z0-9], остальное становится разделителем; подряд идущие
///     разделители сворачиваются в один дефис, по краям дефисы срезаются;
///  5. длинна обрезается по границе слова (не «moby-dic», а «moby»), пустое
///     название даёт <see cref="Fallback"/>;
///  6. кириллица и другие не-латинские буквы правилами 4 выпадают. Для сидов
///     (классика Gutenberg и градированные рассказы) названия латинские, а для
///     системной строки с русским названием слаг сведётся к "book" и получит
///     суффикс коллизии — это наблюдаемое поведение, а не тихая порча URL.
/// </summary>
public static class PublicSlug
{
    /// <summary>Разумный потолок: адрес книги не должен превращаться в простыню.</summary>
    public const int MaxLength = 80;

    /// <summary>Запасной слаг, когда из названия не осталось ни одной буквы.</summary>
    public const string Fallback = "book";

    private static readonly Regex CombiningMarks = new(@"\p{Mn}+", RegexOptions.CultureInvariant);
    private static readonly Regex Ampersand = new(@"\s*&\s*", RegexOptions.CultureInvariant);
    private static readonly Regex Apostrophes = new(@"['’‘‛ʼ`´]", RegexOptions.CultureInvariant);
    private static readonly Regex Separators = new(@"[\s_\-–—/\\|:.+,!?()«»""„“”]+", RegexOptions.CultureInvariant);
    private static readonly Regex NonLatin = new(@"[^a-z0-9-]", RegexOptions.CultureInvariant);
    private static readonly Regex RepeatedHyphen = new(@"-{2,}", RegexOptions.CultureInvariant);

    public static string From(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return Fallback;

        // NFKD + снятие диакритики: «Brontë» → «Bronte», «Café» → «Cafe»
        var text = CombiningMarks.Replace(title.Normalize(NormalizationForm.FormKD), string.Empty);

        text = Ampersand.Replace(text, " and ");
        text = Apostrophes.Replace(text, string.Empty);
        // Дефис остаётся дефисом, всё остальное пунктуационное — пробелом
        text = Separators.Replace(text, " ");
        text = text.ToLowerInvariant();
        // Не-латиница (включая пропустившиеся символы) выпадает целиком
        text = NonLatin.Replace(text, " ");
        text = RepeatedHyphen.Replace(text, "-");
        text = Regex.Replace(text, @"\s+", "-");
        text = text.Trim('-');

        if (text.Length == 0) return Fallback;
        if (text.Length <= MaxLength) return text;

        // Обрезаем по границе слова/дефиса, иначе у короткого названия появится
        // хвост вида "the-adventures-of-sherlock-holm"
        var cut = text[..MaxLength];
        var hyphen = cut.LastIndexOf('-');
        cut = (hyphen > 0 ? cut[..hyphen] : cut).Trim('-');

        return cut.Length == 0 ? Fallback : cut;
    }

    /// <summary>
    /// Раздаёт набору названий по одному слагу. Порядок входа обязан быть
    /// детерминированным (сортировка каталога), тогда и суффиксы коллизий
    /// детерминированы: первое название берёт чистый слаг, второе — «-2»,
    /// третье — «-3». Если «-2» уже занят другим слагом, идёт следующий поиск,
    /// поэтому два разных адреса никогда не указывают на одну книгу.
    /// </summary>
    public static IReadOnlyList<string> AssignSlugs(IEnumerable<string> titles)
    {
        var taken = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<string>();

        foreach (var title in titles)
        {
            var slug = From(title);

            if (!taken.Add(slug))
            {
                var suffix = 2;
                string candidate;
                do
                {
                    candidate = $"{slug}-{suffix}";
                    suffix++;
                }
                while (!taken.Add(candidate));

                slug = candidate;
            }

            result.Add(slug);
        }

        return result;
    }

    /// <summary>
    /// Порядок уровней для сортировки каталога: A1 → C2, неизвестный уровень
    /// в конец. Совпадает с логикой рекомендаций в BooksController.
    /// </summary>
    public static int LevelOrder(string? level)
    {
        if (string.IsNullOrWhiteSpace(level)) return int.MaxValue;

        var index = Array.IndexOf(Levels, level.Trim().ToUpperInvariant());
        return index < 0 ? int.MaxValue : index;
    }

    /// <summary>Шкала, по которой каталог раскладывается на полки.</summary>
    public static readonly string[] Levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
}
