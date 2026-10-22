using EnglishLearningPlatform.API.Security;

namespace EnglishLearningPlatform.API.Tests.Security;

public class AdminKeyGuardTests
{
    private const string ConfiguredKey = "super-secret-admin-key";

    [Fact]
    public void IsAuthorized_CorrectKey_ReturnsTrue() =>
        Assert.True(AdminKeyGuard.IsAuthorized(ConfiguredKey, ConfiguredKey, isDevelopment: false));

    [Fact]
    public void IsAuthorized_WrongKey_ReturnsFalse() =>
        Assert.False(AdminKeyGuard.IsAuthorized("wrong-key", ConfiguredKey, isDevelopment: false));

    [Fact]
    public void IsAuthorized_WrongKeyOfSameLength_ReturnsFalse() =>
        Assert.False(AdminKeyGuard.IsAuthorized(new string('x', ConfiguredKey.Length), ConfiguredKey, isDevelopment: false));

    [Fact]
    public void IsAuthorized_PrefixOfKey_ReturnsFalse() =>
        Assert.False(AdminKeyGuard.IsAuthorized(ConfiguredKey[..10], ConfiguredKey, isDevelopment: false));

    [Fact]
    public void IsAuthorized_EmptyProvidedKey_ReturnsFalse() =>
        Assert.False(AdminKeyGuard.IsAuthorized(string.Empty, ConfiguredKey, isDevelopment: false));

    [Fact]
    public void IsAuthorized_NullProvidedKey_ReturnsFalse() =>
        Assert.False(AdminKeyGuard.IsAuthorized(null, ConfiguredKey, isDevelopment: false));

    [Fact]
    public void IsAuthorized_KeyNotConfiguredInDevelopment_AllowsAccess() =>
        Assert.True(AdminKeyGuard.IsAuthorized(null, configuredKey: null, isDevelopment: true));

    [Fact]
    public void IsAuthorized_KeyNotConfiguredInProduction_DeniesAccess() =>
        Assert.False(AdminKeyGuard.IsAuthorized("anything", configuredKey: null, isDevelopment: false));

    [Fact]
    public void FixedTimeEquals_SameStrings_ReturnsTrue() =>
        Assert.True(AdminKeyGuard.FixedTimeEquals("abc", "abc"));

    [Fact]
    public void FixedTimeEquals_DifferentStrings_ReturnsFalse() =>
        Assert.False(AdminKeyGuard.FixedTimeEquals("abc", "abd"));

    [Fact]
    public void FixedTimeEquals_DifferentLengths_ReturnsFalse() =>
        Assert.False(AdminKeyGuard.FixedTimeEquals("abc", "abcd"));

    [Fact]
    public void FixedTimeEquals_NullInput_ReturnsFalse() =>
        Assert.False(AdminKeyGuard.FixedTimeEquals(null, "abc"));
}
