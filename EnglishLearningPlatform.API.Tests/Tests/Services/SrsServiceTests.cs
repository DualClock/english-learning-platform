using EnglishLearningPlatform.API.Services;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Services;

public class SrsServiceTests
{
    [Theory]
    [InlineData(1, 10, 2.5, 5)]  // quality=1, interval=10, ease=2.5, reps=5
    [InlineData(2, 5, 2.0, 3)]   // quality=2, interval=5, ease=2.0, reps=3
    public void CalculateNextReview_LowQuality_ResetsProgress(
        int quality, int interval, double easeFactor, int repetitions)
    {
        // Act
        var result = SrsService.CalculateNextReview(quality, interval, easeFactor, repetitions);

        // Assert
        Assert.Equal(1, result.interval);
        Assert.Equal(0, result.repetitions);
    }

    [Fact]
    public void CalculateNextReview_FirstRepetition_ReturnsInterval1()
    {
        // Act
        var result = SrsService.CalculateNextReview(4, 0, 2.5, 0);

        // Assert
        Assert.Equal(1, result.interval);
        Assert.Equal(1, result.repetitions);
    }

    [Fact]
    public void CalculateNextReview_SecondRepetition_ReturnsInterval6()
    {
        // Act
        var result = SrsService.CalculateNextReview(4, 1, 2.5, 1);

        // Assert
        Assert.Equal(6, result.interval);
        Assert.Equal(2, result.repetitions);
    }

    [Fact]
    public void CalculateNextReview_ThirdRepetition_MultipliesByEaseFactor()
    {
        // Act
        var result = SrsService.CalculateNextReview(4, 6, 2.5, 2);

        // Assert
        Assert.Equal(15, result.interval); // 6 * 2.5 = 15
        Assert.Equal(3, result.repetitions);
    }

    [Fact]
    public void CalculateNextReview_EasyAnswer_IncreasesEaseFactor()
    {
        // Act
        var result = SrsService.CalculateNextReview(5, 10, 2.5, 3);

        // Assert
        Assert.True(result.easeFactor > 2.5);
    }

    [Fact]
    public void CalculateNextReview_HardAnswer_DecreasesEaseFactor()
    {
        // Act
        var result = SrsService.CalculateNextReview(3, 10, 2.5, 3);

        // Assert
        Assert.True(result.easeFactor < 2.5);
    }

    [Fact]
    public void CalculateNextReview_EaseFactor_HasMinimumValue()
    {
        // Act — множество плохих ответов
        var result = SrsService.CalculateNextReview(3, 100, 1.3, 10);

        // Assert
        Assert.True(result.easeFactor >= 1.3);
    }
}