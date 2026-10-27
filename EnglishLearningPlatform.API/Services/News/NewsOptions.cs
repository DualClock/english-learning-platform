namespace EnglishLearningPlatform.API.Services.News;

/// <summary>
/// Настройки синхронизации ленты — из секции «News» конфигурации.
///
/// Отдельный тип, а не IConfiguration прямо в сервисах: дефолты тогда в одном
/// месте и проверяются тестом, а не разбросаны по `?? 2` и `?? 120`.
/// </summary>
public class NewsOptions
{
    public const string SectionName = "News";

    public const int DefaultFetchIntervalHours = 2;
    public const int DefaultInitialDelayMinutes = 2;
    public const int DefaultRetentionDays = 120;

    /// <summary>
    /// Выключатель опроса. Уборка при этом не выключается: если новости
    /// перестали приезжать, старые всё равно надо снимать с витрины.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Интервал между проходами, часы.</summary>
    public int FetchIntervalHours { get; set; } = DefaultFetchIntervalHours;

    /// <summary>
    /// Пауза перед первым проходом, минуты. Нужна, чтобы миграции и Identity
    /// дозакончили старт: фетчер, пришедший раньше схемы, падает по понятной
    /// причине, но засоряет журнал на каждом рестарте.
    /// </summary>
    public int InitialDelayMinutes { get; set; } = DefaultInitialDelayMinutes;

    /// <summary>Срок хранения новостей по PublishedAt, дни.</summary>
    public int RetentionDays { get; set; } = DefaultRetentionDays;

    /// <summary>
    /// Значения из конфига в рабочий вид.
    ///
    /// Мусор и неположительные числа трактуются как «не задано»: интервал в
    /// ноль часов превратил бы цикл в бесконечный опрос чужого сайта, а срок
    /// хранения в ноль — в удаление всей ленты на первом же проходе.
    /// </summary>
    public static NewsOptions FromConfiguration(IConfiguration configuration)
    {
        var section = configuration.GetSection(SectionName);
        var defaults = new NewsOptions();

        return new NewsOptions
        {
            Enabled = section.GetValue<bool?>(nameof(Enabled)) ?? defaults.Enabled,
            FetchIntervalHours = Positive(
                section.GetValue<int?>(nameof(FetchIntervalHours)), DefaultFetchIntervalHours),
            InitialDelayMinutes = NonNegative(
                section.GetValue<int?>(nameof(InitialDelayMinutes)), DefaultInitialDelayMinutes),
            RetentionDays = Positive(
                section.GetValue<int?>(nameof(RetentionDays)), DefaultRetentionDays)
        };
    }

    public TimeSpan FetchInterval => TimeSpan.FromHours(FetchIntervalHours);

    public TimeSpan InitialDelay => TimeSpan.FromMinutes(InitialDelayMinutes);

    private static int Positive(int? value, int fallback) =>
        value is > 0 ? value.Value : fallback;

    private static int NonNegative(int? value, int fallback) =>
        value is >= 0 ? value.Value : fallback;
}
