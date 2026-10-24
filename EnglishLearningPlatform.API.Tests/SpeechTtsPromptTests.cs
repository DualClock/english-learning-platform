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
}
