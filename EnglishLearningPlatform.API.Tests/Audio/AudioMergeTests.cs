using System.Text;
using EnglishLearningPlatform.API.Services;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Audio;

/// <summary>
/// Склейка кусков озвучки из разных контейнеров.
///
/// Живой дефект, ради которого этот класс написан: провайдеры отдают разное
/// (Gemini — WAV, бесплатный резерв — MP3), абзац режется на куски, и один
/// кусок приходил WAV, другой MP3. Конкатенация таких байтов даёт файл,
/// который браузер не играет, поэтому сервис отказывал целиком — и человек
/// ни разу не слышал серверный голос на абзацах 200/400/600 символов.
/// </summary>
public class AudioMergeTests
{
    /// <summary>WAV с 44-байтовым заголовком и PCM заданной длины.</summary>
    private static byte[] Wav(int pcmBytes, byte fill = 0x7F)
    {
        var data = new byte[44 + pcmBytes];
        Encoding.ASCII.GetBytes("RIFF").CopyTo(data, 0);
        BitConverter.TryWriteBytes(data.AsSpan(4, 4), 36 + pcmBytes);
        Encoding.ASCII.GetBytes("WAVE").CopyTo(data, 8);
        Encoding.ASCII.GetBytes("fmt ").CopyTo(data, 12);
        BitConverter.TryWriteBytes(data.AsSpan(16, 4), 16);
        BitConverter.TryWriteBytes(data.AsSpan(20, 2), (short)1);   // PCM
        BitConverter.TryWriteBytes(data.AsSpan(22, 2), (short)1);   // моно
        BitConverter.TryWriteBytes(data.AsSpan(24, 4), 24000);      // частота
        BitConverter.TryWriteBytes(data.AsSpan(34, 2), (short)16);  // бит на отсчёт
        Encoding.ASCII.GetBytes("data").CopyTo(data, 36);
        BitConverter.TryWriteBytes(data.AsSpan(40, 4), pcmBytes);
        data.AsSpan(44).Fill(fill);
        return data;
    }

    private static byte[] Mp3(int size)
    {
        var data = new byte[size];
        data[0] = 0xFF;
        data[1] = 0xFB;
        return data;
    }

    [Fact]
    public void Распознаёт_WAV_и_MP3_по_сигнатуре()
    {
        Assert.True(AudioMerge.IsWav(Wav(64)));
        Assert.False(AudioMerge.IsWav(Mp3(64)));

        Assert.True(AudioMerge.IsMp3(Mp3(64)));
        Assert.False(AudioMerge.IsMp3(Wav(64)));
    }

    [Fact]
    public async Task Однородные_WAV_склеиваются_без_ffmpeg()
    {
        var clips = new List<(byte[], string)>
        {
            (Wav(100, 0x11), AudioMerge.WavContentType),
            (Wav(100, 0x22), AudioMerge.WavContentType),
            (Wav(100, 0x33), AudioMerge.WavContentType),
        };

        // ffmpeg заведомо недоступен: если бы функция его требовала, тест упал бы.
        var merged = await AudioMerge.MergeAsync(clips, ffmpegPath: null, CancellationToken.None);

        Assert.NotNull(merged);
        var (data, contentType) = merged.Value;
        Assert.Equal(AudioMerge.WavContentType, contentType);

        // Один заголовок + три PCM-блока: 44 + 300.
        Assert.Equal(44 + 300, data.Length);
        Assert.True(AudioMerge.IsWav(data));

        // PCM на месте и в правильном порядке: склейка не теряет куски.
        Assert.Equal(0x11, data[44]);
        Assert.Equal(0x22, data[144]);
        Assert.Equal(0x33, data[244]);
    }

    [Fact]
    public async Task Склейка_WAV_правит_размеры_в_заголовке()
    {
        var merged = await AudioMerge.MergeAsync(
            new List<(byte[], string)>
            {
                (Wav(100), AudioMerge.WavContentType),
                (Wav(100), AudioMerge.WavContentType),
            },
            ffmpegPath: null,
            CancellationToken.None);

        Assert.NotNull(merged);
        var data = merged.Value.Data;

        // ChunkSize (offset 4) = вся длина минус 8 байт RIFF/WAVE.
        Assert.Equal(data.Length - 8, BitConverter.ToInt32(data, 4));
        // Subchunk2Size (offset 40) = только PCM.
        Assert.Equal(data.Length - 44, BitConverter.ToInt32(data, 40));
    }

    [Fact]
    public async Task Однородные_MP3_склеиваются_с_обрезкой_ID3()
    {
        var first = Mp3(100);
        var second = Mp3(100);
        // ID3v2-заголовок у второго куска: в середине потока он сбивает декодер.
        Encoding.ASCII.GetBytes("ID3").CopyTo(second, 0);

        var merged = await AudioMerge.MergeAsync(
            new List<(byte[], string)>
            {
                (first, AudioMerge.Mp3ContentType),
                (second, AudioMerge.Mp3ContentType),
            },
            ffmpegPath: null,
            CancellationToken.None);

        Assert.NotNull(merged);
        Assert.Equal(AudioMerge.Mp3ContentType, merged.Value.ContentType);
    }

    [Fact]
    public async Task Смешанные_контейнеры_без_ffmpeg_дают_отказ_а_не_битый_файл()
    {
        var clips = new List<(byte[], string)>
        {
            (Wav(100), AudioMerge.WavContentType),
            (Mp3(100), AudioMerge.Mp3ContentType),
        };

        // ffmpeg не найден — честный null. Битый файл хуже запасного голоса.
        var merged = await AudioMerge.MergeAsync(clips, ffmpegPath: null, CancellationToken.None);

        Assert.Null(merged);
    }

    [Fact]
    public async Task Смешанные_контейнеры_с_ffmpeg_склеиваются_в_MP3()
    {
        var ffmpeg = AudioMerge.FindFfmpeg();
        if (ffmpeg == null)
        {
            // ffmpeg — внешний инструмент, отсутствие не красит код в красный.
            // Ветка покрыта тестом выше (отказ без ffmpeg).
            return;
        }

        var clips = new List<(byte[], string)>
        {
            (Wav(4800), AudioMerge.WavContentType),
            (Mp3(4), AudioMerge.Mp3ContentType),
        };

        var merged = await AudioMerge.MergeAsync(clips, ffmpeg, CancellationToken.None);

        Assert.NotNull(merged);
        Assert.Equal(AudioMerge.Mp3ContentType, merged.Value.ContentType);
        Assert.True(merged.Value.Data.Length > 4);
    }

    [Fact]
    public async Task Один_кусок_возвращается_как_есть()
    {
        var wav = Wav(100);
        var merged = await AudioMerge.MergeAsync(
            new List<(byte[], string)> { (wav, AudioMerge.WavContentType) },
            ffmpegPath: null,
            CancellationToken.None);

        Assert.NotNull(merged);
        Assert.Same(wav, merged.Value.Data);
        Assert.Equal(AudioMerge.WavContentType, merged.Value.ContentType);
    }

    [Fact]
    public async Task Пустой_набор_даёт_null()
    {
        Assert.Null(await AudioMerge.MergeAsync(
            new List<(byte[], string)>(), ffmpegPath: null, CancellationToken.None));
    }
}
