using System.Text;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Склейка кусков озвучки, пришедших в РАЗНЫХ контейнерах.
///
/// Задача появилась из живого дефекта: провайдеры отдают разное. Gemini —
/// WAV (16-бит PCM моно), бесплатный резерв — MP3. Абзац режется на куски по
/// границам предложений, и один кусок мог достаться кэшу (WAV), другой —
/// резерву (MP3). Склеить WAV с MP3 конкатенацией байтов нельзя: получится
/// файл, который браузер не проиграет. До этого класса такой случай
/// заканчивался отказом (503 → браузерный голос), и абзацы не звучали
/// серверным голосом вовсе.
///
/// Решение: если ВСЕ куски — WAV, склеиваем их как PCM (заголовок только один).
/// Если контейнеры разные, WAV-куски переводим в MP3 через ffmpeg и склеиваем
/// всё как MP3. ffmpeg в системе есть; если его нет — честный отказ, а не
/// битый файл: тишина в середине фразы хуже запасного голоса браузера.
///
/// Почему не перекодировать всегда: WAV→MP3 — потеря качества и лишняя работа
/// на каждый запрос. Если куски уже однородные, склейка бесплатна и без потерь.
/// </summary>
public static class AudioMerge
{
    public const string WavContentType = "audio/wav";
    public const string Mp3ContentType = "audio/mpeg";

    /// <summary>Минимальный корректный WAV-файл: RIFF-заголовок 44 байта.</summary>
    private const int WavHeaderSize = 44;

    public static bool IsWav(byte[] data) =>
        data.Length > WavHeaderSize &&
        data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 && // RIFF
        data[8] == 0x57 && data[9] == 0x41 && data[10] == 0x56 && data[11] == 0x45; // WAVE

    public static bool IsMp3(byte[] data) =>
        data.Length > 3 &&
        ((data[0] == 0x49 && data[1] == 0x44 && data[2] == 0x33) ||      // ID3
         (data[0] == 0xFF && (data[1] & 0xE0) == 0xE0));                 // кадр

    /// <summary>
    /// Склеивает куски в один файл. Возвращает байты и их тип, либо null,
    /// если склеить нельзя (нет ffmpeg, неизвестный формат).
    /// </summary>
    public static async Task<(byte[] Data, string ContentType)?> MergeAsync(
        IReadOnlyList<(byte[] Data, string ContentType)> clips,
        string? ffmpegPath,
        CancellationToken cancellationToken,
        string? scratchDirectory = null)
    {
        if (clips.Count == 0)
        {
            return null;
        }

        if (clips.Count == 1)
        {
            return (clips[0].Data, clips[0].ContentType);
        }

        var allWav = clips.All(clip => IsWav(clip.Data));
        if (allWav)
        {
            var merged = ConcatPcm(clips.Select(clip => clip.Data).ToList());
            return merged == null ? null : (merged, WavContentType);
        }

        var allMp3 = clips.All(clip => !IsWav(clip.Data));
        if (allMp3)
        {
            return (SpeechSegmentPlanner.Concat(clips.Select(clip => clip.Data).ToList()), Mp3ContentType);
        }

        // Смешанный набор: единственный путь — привести WAV к MP3 и склеить.
        if (string.IsNullOrWhiteSpace(ffmpegPath) || !File.Exists(ffmpegPath))
        {
            return null;
        }

        var mp3Clips = new List<byte[]>(clips.Count);
        foreach (var clip in clips)
        {
            if (IsWav(clip.Data))
            {
                var converted = await ConvertWavToMp3Async(clip.Data, ffmpegPath, cancellationToken, scratchDirectory);
                if (converted == null)
                {
                    return null;
                }

                mp3Clips.Add(converted);
            }
            else
            {
                mp3Clips.Add(clip.Data);
            }
        }

        return (SpeechSegmentPlanner.Concat(mp3Clips), Mp3ContentType);
    }

    /// <summary>
    /// Склейка PCM из нескольких WAV: берём заголовок первого и «data» всех.
    ///
    /// Формат у всех кусков один (Gemini отдаёт моно 16-бит на одной частоте —
    /// см. SpeechService.WrapWav), поэтому пересчитывать ничего не нужно,
    /// кроме размера в заголовке.
    /// </summary>
    public static byte[]? ConcatPcm(IReadOnlyList<byte[]> wavs)
    {
        if (wavs.Count == 0)
        {
            return null;
        }

        if (wavs.Count == 1)
        {
            return wavs[0];
        }

        var header = wavs[0].AsSpan(0, WavHeaderSize).ToArray();
        var totalPcm = wavs.Sum(wav => Math.Max(0, wav.Length - WavHeaderSize));

        using var stream = new MemoryStream(WavHeaderSize + totalPcm);
        stream.Write(header, 0, WavHeaderSize);

        foreach (var wav in wavs)
        {
            if (wav.Length > WavHeaderSize)
            {
                stream.Write(wav, WavHeaderSize, wav.Length - WavHeaderSize);
            }
        }

        var result = stream.ToArray();

        // Правим два счётчика в RIFF-заголовке: ChunkSize (offset 4) и
        // Subchunk2Size у «data» (offset 40). Иначе плеер прочтёт только
        // первую часть и оборвёт фразу.
        var riffSize = result.Length - 8;
        var dataSize = result.Length - WavHeaderSize;
        BitConverter.TryWriteBytes(result.AsSpan(4, 4), riffSize);
        BitConverter.TryWriteBytes(result.AsSpan(40, 4), dataSize);

        return result;
    }

    /// <summary>
    /// WAV → MP3 через ffmpeg. Моно, 24 кбит/с: голос остаётся разборчивым,
    /// а размер небольшой (одна фраза ≈ 5–10 КБ).
    /// </summary>
    public static async Task<byte[]?> ConvertWavToMp3Async(
        byte[] wav,
        string ffmpegPath,
        CancellationToken cancellationToken,
        string? scratchDirectory = null)
    {
        var scratch = scratchDirectory ?? ResolveScratchDirectory();
        if (scratch == null)
        {
            return null;
        }

        var tempIn = Path.Combine(scratch, $"lexicon-tts-{Guid.NewGuid():N}.wav");
        var tempOut = Path.ChangeExtension(tempIn, ".mp3");

        try
        {
            await File.WriteAllBytesAsync(tempIn, wav, cancellationToken);

            var startInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = ffmpegPath,
                ArgumentList =
                {
                    "-hide_banner", "-loglevel", "error",
                    "-y", "-i", tempIn,
                    "-codec:a", "libmp3lame", "-b:a", "24k", "-ac", "1",
                    tempOut
                },
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = System.Diagnostics.Process.Start(startInfo);
            if (process == null)
            {
                return null;
            }

            await process.WaitForExitAsync(cancellationToken);
            if (process.ExitCode != 0 || !File.Exists(tempOut))
            {
                return null;
            }

            return await File.ReadAllBytesAsync(tempOut, cancellationToken);
        }
        catch (Exception)
        {
            // ffmpeg нет, он упал или файл занят — вызывающий честно откажет
            // и клиент прочитает фразу браузерным голосом.
            return null;
        }
        finally
        {
            TryDelete(tempIn);
            TryDelete(tempOut);
        }
    }

    /// <summary>
    /// Каталог для временных WAV/MP3 при конвертации.
    ///
    /// <c>Path.GetTempPath()</c> под Windows берёт TMPDIR/TEMP, и на этой машине
    /// он указывает на <c>C:\Temp</c> — каталог есть, но писать в него нельзя
    /// (UnauthorizedAccessException). <c>%LOCALAPPDATA%\Lexicon</c> — тоже.
    /// Из-за этого склейка смешанных кусков молча возвращала null, и абзацы
    /// не звучали серверным голосом.
    ///
    /// Единственное место, куда процесс гарантированно пишет, — свой
    /// <c>uploads</c> (там же лежат книги, обложки и аватары). Поэтому
    /// временные файлы идут в <c>uploads/tts-temp</c>, а не в системный temp.
    /// </summary>
    /// <param name="contentRoot">ContentRoot приложения (где лежит uploads).</param>
    public static string? ResolveScratchDirectory(string? contentRoot = null)
    {
        var candidates = new List<string>();

        if (!string.IsNullOrWhiteSpace(contentRoot))
        {
            candidates.Add(Path.Combine(contentRoot, "uploads", "tts-temp"));
        }

        // Из журнала тестов и консольных запусков ContentRoot может быть не задан.
        candidates.Add(Path.Combine(Directory.GetCurrentDirectory(), "uploads", "tts-temp"));

        foreach (var candidate in candidates)
        {
            try
            {
                Directory.CreateDirectory(candidate);

                // Проверяем именно запись: каталог может существовать и быть
                // недоступным, как C:\Temp на этой машине.
                var probe = Path.Combine(candidate, $".probe-{Guid.NewGuid():N}");
                File.WriteAllBytes(probe, Array.Empty<byte>());
                File.Delete(probe);
                return candidate;
            }
            catch (Exception)
            {
                // пробуем следующего кандидата
            }
        }

        return null;
    }

    /// <summary>Ищет ffmpeg в PATH или по явной настройке. null — не найден.</summary>
    /// <param name="configuredPath">Значение <c>Tts:FfmpegPath</c> из конфигурации.</param>
    public static string? FindFfmpeg(string? configuredPath = null)
    {
        if (!string.IsNullOrWhiteSpace(configuredPath) && File.Exists(configuredPath))
        {
            return configuredPath;
        }

        var name = OperatingSystem.IsWindows() ? "ffmpeg.exe" : "ffmpeg";
        var pathVariable = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;

        foreach (var raw in pathVariable.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var directory = raw.Trim();
            if (directory.Length == 0)
            {
                continue;
            }

            foreach (var candidate in Candidates(directory, name))
            {
                try
                {
                    if (File.Exists(candidate))
                    {
                        return candidate;
                    }
                }
                catch (ArgumentException)
                {
                    // мусорная запись в PATH — пропускаем
                }
            }
        }

        return null;
    }

    /// <summary>
    /// Пути, по которым может лежать ffmpeg в этой записи PATH.
    ///
    /// На Windows PATH часто достаётся от MSYS/git-bash в виде
    /// <c>/c/Users/…/bin</c> — .NET такой путь не понимает и File.Exists
    /// вернёт false. Поэтому пробуем и его, и перевод в <c>C:\Users\…</c>.
    /// </summary>
    private static IEnumerable<string> Candidates(string directory, string name)
    {
        yield return Path.Combine(directory, name);

        if (directory.Length > 2 && directory[0] == '/' && char.IsLetter(directory[1]) && directory[2] == '/')
        {
            var drive = char.ToUpperInvariant(directory[1]);
            var rest = directory[3..].Replace('/', '\\');
            yield return $"{drive}:\\{rest}\\{name}";
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
            // временный файл, чистить не обязательно
        }
    }
}
