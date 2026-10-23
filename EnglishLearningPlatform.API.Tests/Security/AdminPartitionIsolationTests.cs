using System.Net;
using System.Threading.RateLimiting;
using EnglishLearningPlatform.API.Security;
using Microsoft.AspNetCore.Http;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// R-05: политика «admin» защищает пять служебных эндпоинтов (сводка,
/// выгрузка каналов, отзывы беты, сиды контента). Партиция строилась через
/// RateLimitPartitionKeys.Identity = sha256(IP + email из тела запроса), но
/// админские запросы поля email не содержат, а GET вообще не читается.
/// Значит у всех запросов без email одна партиция, и пока
/// Proxy__TrustedCidrs не настроен, «IP» — это адрес прокси: весь мир
/// попадает в одну корзину на 10 запросов / 5 минут. Любой вошедший
/// пользователь выжигает её и закрывает владельцу доступ к его же бете.
/// Правильная партиция для admin — по значению presented-ключа: легитимный
/// владелец ключа всегда получает собственную корзину, а анонимный флуд
/// сидит в своей.
/// </summary>
public class AdminPartitionIsolationTests
{
    private const string ProxyIp = "198.51.100.7";
    private const string OwnerKey = "owner-seed-key-very-secret";

    private static DefaultHttpContext AdminRequest(string ip, string? seedKey)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(ip);
        context.Request.Method = HttpMethods.Get;

        if (seedKey != null)
        {
            context.Request.Headers["X-Seed-Key"] = seedKey;
        }

        return context;
    }

    [Fact]
    public void Admin_KeyHolder_HasItsOwnBucket_AnonymousFloodCannotEmptyIt()
    {
        using var limiter = PartitionedRateLimiter.Create<HttpContext, string>(RateLimitPolicies.AdminPartition);

        // Атакующий без ключа сжигает свою корзину целиком (10 разрешённых).
        var grantedAnonymously = 0;
        for (var i = 0; i < 40; i++)
        {
            using var lease = limiter.AttemptAcquire(AdminRequest(ProxyIp, seedKey: null));
            if (lease.IsAcquired) grantedAnonymously++;
        }

        Assert.Equal(10, grantedAnonymously);

        // Владелец ключа после этого всё ещё получает доступ — раньше он попадал
        // в ту же самую исчерпанную корзину.
        using var ownerLease = limiter.AttemptAcquire(AdminRequest(ProxyIp, OwnerKey));
        Assert.True(ownerLease.IsAcquired,
            "флуд без ключа не должен отрезать владельца ключа от админских эндпоинтов");
    }

    [Fact]
    public void Admin_DifferentKeyValues_GetSeparateBuckets()
    {
        var first = RateLimitPolicies.AdminPartition(AdminRequest(ProxyIp, OwnerKey));
        var second = RateLimitPolicies.AdminPartition(AdminRequest(ProxyIp, "someone-elses-key"));

        Assert.NotEqual(first.PartitionKey, second.PartitionKey);
    }

    [Fact]
    public void Admin_PartitionKey_DoesNotContainTheSecretItself()
    {
        var partition = RateLimitPolicies.AdminPartition(AdminRequest(ProxyIp, OwnerKey));

        // Ключ лимитера оседает в памяти процесса и в метриках — исходное
        // секретное значение там быть не должно.
        Assert.DoesNotContain(OwnerKey, partition.PartitionKey, StringComparison.Ordinal);
    }

    [Fact]
    public void Admin_WithoutKey_StillPartitionedByIp()
    {
        var here = RateLimitPolicies.AdminPartition(AdminRequest(ProxyIp, seedKey: null));
        var there = RateLimitPolicies.AdminPartition(AdminRequest("203.0.113.9", seedKey: null));

        Assert.NotEqual(here.PartitionKey, there.PartitionKey);
    }
}
