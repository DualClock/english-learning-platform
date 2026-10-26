using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EnglishLearningPlatform.API.Services;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// Полнота пака озвучки (R9): 4500 слов словаря должны иметь файл, который найдёт
/// <see cref="SpeechService"/> — иначе клик по слову уходит к провайдеру, тратит
/// квоту и ждёт 3–6 с. <see cref="SpeechPackTests"/> доказывает, что пак
/// выигрывает у провайдера; этот тест доказывает, что пак ПОЛНЫЙ.
///
/// Имя файла считается здесь независимо от бэкенда и от generate.py — по той же
/// формуле, что <c>SpeechService.FindPackFile</c>:
/// <c>sha256("pack|" + слово в нижнем регистре, пробелы схлопнуты).mp3</c>.
/// Поэтому любая рассинхронизация (регистр, пробелы, разделитель) валит тест.
///
/// Тест смотрит в НАСТОЯЩИЙ каталог пака репозитория, а не во временный: смысл
/// проверки — что артефакт, который уедет на сервер, полон. Путь ищется вверх
/// от каталога сборки, чтобы тест не зависел от cwd раннера.
/// </summary>
public class SpeechPackCoverageTests
{
    private const int ExpectedWords = 4500;

    /// <summary>Ниже этого размера файл — битый огрызок от прерванного прогона, а не слово.</summary>
    private const int MinFileBytes = 1024;

    [Fact]
    public void Все_слова_словаря_есть_в_паке()
    {
        var repo = FindRepositoryRoot();
        var wordsPath = Path.Combine(repo, "EnglishLearningPlatform.API", "Data", "Seed", "wordlists.json");
        Assert.True(File.Exists(wordsPath), $"не найден сид слов: {wordsPath}");

        var pack = Path.Combine(repo, "EnglishLearningPlatform.API", "uploads", "tts-pack");
        Assert.True(Directory.Exists(pack),
            $"нет каталога пака {pack} — прогоните tools/tts-pack/generate.py (см. docs/execution/TTS_PACK.md)");

        var words = ReadWords(wordsPath);
        Assert.Equal(ExpectedWords, words.Count);

        // Пропавшие по паре причин в одном списке: так в сообщении видно,
        // отличается ли пак пустым каталогом или единичными словами.
        var missing = new List<string>();
        var truncated = new List<string>();
        foreach (var word in words)
        {
            var path = Path.Combine(pack, PackFileName(word));
            if (!File.Exists(path))
            {
                missing.Add(word);
                continue;
            }

            var size = new FileInfo(path).Length;
            if (size < MinFileBytes)
            {
                truncated.Add($"{word} ({size} Б)");
            }
        }

        var covered = words.Count - missing.Count - truncated.Count;
        Assert.True(missing.Count == 0 && truncated.Count == 0,
            $"пак неполный: {covered} из {words.Count} слов. " +
            $"Нет файла: {missing.Count}{(missing.Count > 0 ? " — " + string.Join(", ", missing.Take(10)) : string.Empty)}. " +
            $"Битые (<{MinFileBytes} Б): {truncated.Count}{(truncated.Count > 0 ? " — " + string.Join(", ", truncated.Take(10)) : string.Empty)}. " +
            "Лечится повторным прогоном generate.py: готовые файлы он пропускает.");
    }

    /// <summary>
    /// Обратная сторона полноты: в паке не должно быть файлов, которых нет в
    /// словаре. Такие файлы — след старого голоса/опечатки в списке слов: они
    /// весят на сервере и маскируют ошибку генерации.
    /// </summary>
    [Fact]
    public void В_паке_нет_файлов_вне_словаря()
    {
        var repo = FindRepositoryRoot();
        var wordsPath = Path.Combine(repo, "EnglishLearningPlatform.API", "Data", "Seed", "wordlists.json");
        var pack = Path.Combine(repo, "EnglishLearningPlatform.API", "uploads", "tts-pack");
        if (!Directory.Exists(pack))
        {
            return;
        }

        var expected = ReadWords(wordsPath).Select(PackFileName).ToHashSet(StringComparer.OrdinalIgnoreCase);

        // .tmp — недоименованные файлы прерванного прогона: в пак они не попали,
        // но занимают место, поэтому тоже считаются браком.
        var stray = Directory.EnumerateFiles(pack)
            .Select(Path.GetFileName)
            .Where(name => name is not null && !expected.Contains(name))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        Assert.True(stray.Count == 0,
            $"в паке {stray.Count} лишних файлов (первые 10): {string.Join(", ", stray.Take(10))}");
    }

    private static string PackFileName(string word)
    {
        var normalized = string.Join(' ',
            word.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();
        var key = SpeechService.GetPackKey(normalized);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();
        return hash + ".mp3";
    }

    private static List<string> ReadWords(string path)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        var words = new List<string>();
        foreach (var entry in document.RootElement.GetProperty("wordLevels").EnumerateArray())
        {
            var text = entry.GetProperty("text").GetString();
            if (!string.IsNullOrWhiteSpace(text))
            {
                words.Add(text);
            }
        }

        return words;
    }

    /// <summary>
    /// Явный путь к дереву репозитория: нужен, когда сборка лежит вне его
    /// (например, раннер собран в обход занятого API.exe). Без переменной
    /// корень ищется вверх по каталогам от сборки.
    /// </summary>
    private const string RootOverrideVariable = "ELP_REPO_ROOT";

    /// <summary>
    /// Корень репозитория: сначала ELP_REPO_ROOT, иначе вверх от каталога
    /// сборки (bin/Debug/net10.0/...) до EnglishLearningPlatform.slnx. cwd
    /// раннера ненадёжен — TestRunner можно запустить из любого каталога.
    /// </summary>
    private static string FindRepositoryRoot()
    {
        var configured = Environment.GetEnvironmentVariable(RootOverrideVariable);
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return Path.GetFullPath(configured);
        }

        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "EnglishLearningPlatform.slnx")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException(
            $"не найден корень репозитория (EnglishLearningPlatform.slnx) выше {AppContext.BaseDirectory}");
    }
}
