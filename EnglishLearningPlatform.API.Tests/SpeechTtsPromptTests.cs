using EnglishLearningPlatform.API.Services;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// Контур озвучки слова.
///
/// Оба правила родились из замеров на проде 24.10, а не из догадок:
///  - одиночное слово `cheshire` и словосочетание `Cheshire Cat` модель
///    gemini-2.5-flash-preview-tts отдавала HTTP 200 без аудиочасти либо 400
///    «Model tried to generate text…»; в кавычках стабильно возвращается PCM;
///  - текстовые запасные пути (fallback-провайдер, Pollinations) для запроса
///    озвучки только тратят время и превращают отказ в 503 «no audio data».
/// </summary>
public class SpeechTtsPromptTests
{
    [Theory]
    [InlineData("white rabbit", "\"white rabbit\"")]
    [InlineData("Cheshire Cat", "\"Cheshire Cat\"")]
    [InlineData("one", "\"one\"")]
    public void Промпт_озвучки_обёрнут_в_кавычки(string input, string expected)
        => Assert.Equal(expected, SpeechService.BuildTtsPrompt(input));

    [Theory]
    [InlineData("tts", true)]
    [InlineData("TTS", true)]
    [InlineData("translate", false)]
    [InlineData("generate_json", false)]
    [InlineData(null, false)]
    public void Аудиозапрос_не_гонится_через_текстовые_запасные_пути(string? requestType, bool expected)
        => Assert.Equal(expected, ResilientAiService.IsAudioRequest(requestType));

    [Fact]
    public void Резервная_озвучка_кодирует_текст_и_просит_английский_голос()
    {
        var url = SpeechService.BuildGtxUrl("white rabbit & tea");

        Assert.StartsWith("https://translate.google.com/translate_tts?", url);
        Assert.Contains("tl=en", url);
        Assert.Contains("client=tw-ob", url);
        Assert.Contains("white%20rabbit%20%26%20tea", url);
        Assert.DoesNotContain(" ", url);
    }

    [Fact]
    public void Отказ_резервной_озвучки_отличается_от_аудио()
    {
        Assert.True(SpeechService.LooksLikeMp3(new byte[] { 0x49, 0x44, 0x33, 0x04, 0x00 }));
        Assert.True(SpeechService.LooksLikeMp3(new byte[] { 0xFF, 0xFB, 0x90, 0x64 }));
        Assert.False(SpeechService.LooksLikeMp3(System.Text.Encoding.UTF8.GetBytes("<html>429</html>")));
        Assert.False(SpeechService.LooksLikeMp3(Array.Empty<byte>()));
    }

    [Fact]
    public void Ключ_пака_совпадает_с_тем_что_пишет_генератор()
    {
        // Контракт с tools/tts-pack/generate.py: имя файла =
        // sha256("pack|" + слово в нижнем регистре). Если кто-то поменяет одну
        // сторону, пак перестанет находиться — и это должно падать здесь, а не в проде.
        Assert.Equal("pack|rabbit", SpeechService.GetPackKey("rabbit"));

        var hash = Convert.ToHexString(
            System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(SpeechService.GetPackKey("a")))).ToLowerInvariant();

        Assert.Equal("a26fb61aa788f12706e0cb7c6daa450150203c4a22752af3d41ef42431aa05a0", hash);
    }

    [Fact]
    public void После_исчерпания_квоты_Gemini_пропускается_до_конца_кулдауна()
    {
        var now = new DateTime(2026, 10, 24, 12, 0, 0, DateTimeKind.Utc);

        Assert.True(SpeechService.ShouldSkipGeminiTts(now, now.Add(SpeechService.TtsQuotaCooldown)));
        Assert.False(SpeechService.ShouldSkipGeminiTts(now, now));
        Assert.False(SpeechService.ShouldSkipGeminiTts(now, now.AddMinutes(-1)));
        Assert.Equal(TimeSpan.FromMinutes(30), SpeechService.TtsQuotaCooldown);
    }
}
