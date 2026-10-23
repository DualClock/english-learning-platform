using System.Net;
using System.Text;
using System.Threading.RateLimiting;
using EnglishLearningPlatform.API.Security;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using IpNetwork = System.Net.IPNetwork;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// A5 (SECURITY_GATE 1.4): за прокси RemoteIpAddress у всех = адрес прокси,
/// поэтому лимит логина по одному IP превращается в DoS для всех сразу.
/// Партиция auth/admin = sha256(IP + нормализованный email из тела), а
/// ForwardedHeaders включаются только для явных доверенных CIDR.
/// </summary>
public class RateLimitPartitionTests
{
    private const string ProxyIp = "198.51.100.7";

    private static DefaultHttpContext LoginRequest(string ip, string? emailJson)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(ip);
        context.Request.Method = HttpMethods.Post;
        context.Request.ContentType = "application/json";

        if (emailJson != null)
        {
            var bytes = Encoding.UTF8.GetBytes(emailJson);
            context.Request.ContentLength = bytes.Length;
            context.Request.Body = new MemoryStream(bytes);
        }

        return context;
    }

    [Fact]
    public void SameIp_DifferentEmails_GetDifferentPartitionKeys()
    {
        var a = RateLimitPolicies.AuthPartition(LoginRequest(ProxyIp, """{"email":"alice@example.com","password":"x"}"""));
        var b = RateLimitPolicies.AuthPartition(LoginRequest(ProxyIp, """{"email":"bob@example.com","password":"x"}"""));

        Assert.NotEqual(a.PartitionKey, b.PartitionKey);
    }

    [Fact]
    public void SameIp_SameEmail_DifferentCaseAndPadding_SharePartitionKey()
    {
        var a = RateLimitPolicies.AuthPartition(LoginRequest(ProxyIp, """{"Email":" Alice@Example.COM ","password":"x"}"""));
        var b = RateLimitPolicies.AuthPartition(LoginRequest(ProxyIp, """{"email":"alice@example.com","password":"x"}"""));

        Assert.Equal(a.PartitionKey, b.PartitionKey);
    }

    [Fact]
    public void DifferentIps_SameEmail_GetDifferentPartitionKeys()
    {
        var a = RateLimitPolicies.AuthPartition(LoginRequest(ProxyIp, """{"email":"alice@example.com","password":"x"}"""));
        var b = RateLimitPolicies.AuthPartition(LoginRequest("203.0.113.9", """{"email":"alice@example.com","password":"x"}"""));

        Assert.NotEqual(a.PartitionKey, b.PartitionKey);
    }

    [Fact]
    public void Auth_429ForOneEmail_DoesNotBlockOtherEmailFromSameIp()
    {
        // Тот же PartitionedRateLimiter, который строит UseRateLimiter:
        // лимитер создаётся один на PartitionKey и переиспользуется.
        using var limiter = PartitionedRateLimiter.Create<HttpContext, string>(RateLimitPolicies.AuthPartition);

        var alice = LoginRequest(ProxyIp, """{"email":"alice@example.com","password":"wrong"}""");
        var bob = LoginRequest(ProxyIp, """{"email":"bob@example.com","password":"whatever"}""");

        var granted = 0;
        for (var i = 0; i < 20; i++)
        {
            using var lease = limiter.AttemptAcquire(alice);
            if (lease.IsAcquired) granted++;
        }

        Assert.Equal(10, granted);

        using (var blocked = limiter.AttemptAcquire(alice))
        {
            Assert.False(blocked.IsAcquired);
        }

        using var bobLease = limiter.AttemptAcquire(bob);
        Assert.True(bobLease.IsAcquired);
    }

    [Fact]
    public void Auth_BodyIsStillReadableAfterPartitioning()
    {
        var ctx = LoginRequest(ProxyIp, """{"email":"alice@example.com","password":"x"}""");
        _ = RateLimitPolicies.AuthPartition(ctx);

        ctx.Request.Body.Position = 0;
        using var reader = new StreamReader(ctx.Request.Body, Encoding.UTF8);
        Assert.Contains("alice@example.com", reader.ReadToEnd());
    }

    [Fact]
    public void MissingOrGarbageBody_FallsBackToIpOnlyPartition()
    {
        var noBody = RateLimitPolicies.AuthPartition(LoginRequest(ProxyIp, null));
        var garbage = RateLimitPolicies.AuthPartition(LoginRequest(ProxyIp, "not-json{"));
        var emptyEmail = RateLimitPolicies.AuthPartition(LoginRequest(ProxyIp, """{"password":"x"}"""));

        // без email все трое делят одну партицию по IP — поведение как раньше,
        // но не блокирование чужих партиций с email
        Assert.Equal(noBody.PartitionKey, garbage.PartitionKey);
        Assert.Equal(noBody.PartitionKey, emptyEmail.PartitionKey);

        var withEmail = RateLimitPolicies.AuthPartition(LoginRequest(ProxyIp, """{"email":"zed@example.com"}"""));
        Assert.NotEqual(noBody.PartitionKey, withEmail.PartitionKey);
    }

    [Fact]
    public void SignupPolicy_FivePerHourFromOneIp_ThenBlocked()
    {
        using var limiter = PartitionedRateLimiter.Create<HttpContext, string>(RateLimitPolicies.SignupPartition);
        var ctx = LoginRequest(ProxyIp, null);

        var granted = 0;
        for (var i = 0; i < 8; i++)
        {
            using var lease = limiter.AttemptAcquire(ctx);
            if (lease.IsAcquired) granted++;
        }

        Assert.Equal(5, granted);
    }

    [Fact]
    public void AdminPolicy_PartitionsByIpPlusLoginLikeAuth()
    {
        var a = RateLimitPolicies.AdminPartition(LoginRequest(ProxyIp, """{"email":"alice@example.com"}"""));
        var b = RateLimitPolicies.AdminPartition(LoginRequest(ProxyIp, """{"email":"bob@example.com"}"""));

        Assert.NotEqual(a.PartitionKey, b.PartitionKey);
    }
}

public class TrustedProxySetupTests
{
    [Fact]
    public void EmptyTrustedCidrs_TrustsNobody_AndDisablesForwarding()
    {
        var options = new ForwardedHeadersOptions();
        TrustedProxySetup.Configure(options, null);

#pragma warning disable ASPDEPR005 // проверяем, что и устаревшие коллекции пусты
        Assert.Empty(options.KnownNetworks);
#pragma warning restore ASPDEPR005
        Assert.Empty(options.KnownIPNetworks);
        Assert.Empty(options.KnownProxies);
        Assert.Equal(ForwardedHeaders.None, options.ForwardedHeaders);
    }

    [Fact]
    public void TrustedCidrs_AreParsedIntoKnownNetworks()
    {
        var options = new ForwardedHeadersOptions();
        TrustedProxySetup.Configure(options, "10.0.0.0/24, 203.0.113.5");

        Assert.Equal(ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto, options.ForwardedHeaders);
        Assert.Contains(options.KnownIPNetworks, n => n.Equals(IpNetwork.Parse("10.0.0.0/24")));
        Assert.Contains(options.KnownIPNetworks, n => n.Equals(IpNetwork.Parse("203.0.113.5/32")));
    }

    [Fact]
    public void InvalidCidrs_AreSkippedWithoutThrowing()
    {
        var options = new ForwardedHeadersOptions();
        TrustedProxySetup.Configure(options, "garbage, 10.0.0.0/24, , 10.0.0.0/999");

        Assert.Single(options.KnownIPNetworks, n => n.Equals(IpNetwork.Parse("10.0.0.0/24")));
    }
}
