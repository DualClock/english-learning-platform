using EnglishLearningPlatform.API.Services;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Services;

public class SrsServiceTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public void CalculateNextReview_LowQuality_SchedulesLearningStep(int quality)
    {
        // Act
        var result = SrsService.CalculateNextReview(
            quality, currentInterval: 10, currentIntervalMinutes: 0,
            currentEaseFactor: 2.5, currentRepetitions: 5, currentLapses: 0,
            applyFuzz: false);

        // Assert: «Забыл» возвращается через 10 минут, прогресс сбрасывается
        Assert.Equal(0, result.IntervalDays);
        Assert.Equal(SrsService.LearningStepMinutes, result.IntervalMinutes);
        Assert.Equal(0, result.Repetitions);
        Assert.Equal(1, result.Lapses);
        Assert.True(result.EaseFactor < 2.5);
    }

    [Fact]
    public void CalculateNextReview_LowQuality_IncreasesLapsesAndMarksLeech()
    {
        var result = SrsService.CalculateNextReview(
            1, 10, 0, 2.5, 5, currentLapses: 3, applyFuzz: false);

        Assert.Equal(4, result.Lapses);
        Assert.True(result.IsLeech);
    }

    [Fact]
    public void CalculateNextReview_FirstRepetition_ReturnsInterval1()
    {
        var result = SrsService.CalculateNextReview(4, 0, 0, 2.5, 0, 0, applyFuzz: false);

        Assert.Equal(1, result.IntervalDays);
        Assert.Equal(1, result.Repetitions);
        Assert.Equal(0, result.IntervalMinutes);
    }

    [Fact]
    public void CalculateNextReview_SecondRepetition_ReturnsInterval6()
    {
        var result = SrsService.CalculateNextReview(4, 1, 0, 2.5, 1, 0, applyFuzz: false);

        Assert.Equal(6, result.IntervalDays);
        Assert.Equal(2, result.Repetitions);
    }

    [Fact]
    public void CalculateNextReview_ThirdRepetition_MultipliesByEaseFactor()
    {
        var result = SrsService.CalculateNextReview(4, 6, 0, 2.5, 2, 0, applyFuzz: false);

        Assert.Equal(15, result.IntervalDays); // 6 * 2.5 = 15
        Assert.Equal(3, result.Repetitions);
    }

    [Fact]
    public void CalculateNextReview_EasyAnswer_IncreasesEaseFactor()
    {
        var result = SrsService.CalculateNextReview(5, 10, 0, 2.5, 3, 0, applyFuzz: false);

        Assert.True(result.EaseFactor > 2.5);
    }

    [Fact]
    public void CalculateNextReview_HardAnswer_DecreasesEaseFactor()
    {
        var result = SrsService.CalculateNextReview(3, 10, 0, 2.5, 3, 0, applyFuzz: false);

        Assert.True(result.EaseFactor < 2.5);
    }

    [Fact]
    public void CalculateNextReview_EaseFactor_HasMinimumValue()
    {
        var result = SrsService.CalculateNextReview(3, 100, 0, 1.3, 10, 0, applyFuzz: false);

        Assert.True(result.EaseFactor >= 1.3);
    }

    [Fact]
    public void CalculateNextReview_Interval_IsCapped()
    {
        var result = SrsService.CalculateNextReview(5, 100_000, 0, 3.0, 10, 0, applyFuzz: false);

        Assert.True(result.IntervalDays <= SrsService.MaxIntervalDays);
    }

    [Fact]
    public void CalculateNextReview_Leech_DoesNotGetLongInterval()
    {
        // 4 срыва уже были — слово «проблемное», дальше 3 дней не уходит
        var result = SrsService.CalculateNextReview(5, 10, 0, 2.5, 5, currentLapses: 4, applyFuzz: false);

        Assert.True(result.IsLeech);
        Assert.True(result.IntervalDays <= SrsService.LeechMaxIntervalDays);
    }

    [Fact]
    public void CalculateNextReview_LearningCardPassed_ReturnsOneDay()
    {
        // Слово было в learning step (10 минут), ответили «Хорошо»
        var result = SrsService.CalculateNextReview(4, 0, 10, 2.5, 0, 0, applyFuzz: false);

        Assert.Equal(1, result.IntervalDays);
        Assert.Equal(0, result.IntervalMinutes);
        Assert.Equal(1, result.Repetitions);
    }
}
