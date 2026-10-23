namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Разрешённый набор эмодзи для слов. Хранится в коде, как каталог достижений:
/// сервер не принимает произвольные строки, а фронтенд показывает этот же набор.
/// </summary>
public static class WordVisualCatalog
{
    public static readonly HashSet<string> AllowedEmojis = new(StringComparer.Ordinal)
    {
        "🍎", "🍞", "☕", "🥛", "🌊", "🌿", "🌻", "☀️",
        "🌙", "🔥", "❄️", "🏠", "🚗", "✈️", "🎒", "📚",
        "✏️", "💡", "🔑", "🕰️", "🎵", "🎨", "💬", "❤️",
        "😊", "😢", "😴", "🏃", "🧠", "💰", "⚽", "🐈"
    };

    public static bool IsAllowedEmoji(string? emoji) =>
        !string.IsNullOrWhiteSpace(emoji) && AllowedEmojis.Contains(emoji.Trim());
}
