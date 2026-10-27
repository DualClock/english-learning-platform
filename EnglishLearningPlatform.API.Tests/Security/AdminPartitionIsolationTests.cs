using System.Net;
using System.Security.Claims;
using System.Threading.RateLimiting;
using EnglishLearningPlatform.API.Security;
using Microsoft.AspNetCore.Http;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// R-05: политика «admin» защищает админские эндпоинты (сиды контента, сводка,
/// отзывы, CRUD CMS). Задача партиции — чтобы один клиент не мог закрыть
/// доступ владельцу.
///
/// До CMS-0 партиция строилась по заголовку X-Seed-Key. С переходом на роль
/// этого заголовка в запросе нет вовсе, и проверка всегда падала в ветку
/// «ip:{адрес}»: при неверно настроенном Proxy__TrustedCidrs все админские
/// запросы мира попадали в одну корзину на 10 запросов / 5 минут.
///
/// Теперь ключ партиции — id аутентифицированного пользователя, поэтому
/// лимитер обязан идти ПОСЛЕ UseAuthentication (см. Program.cs). Тесты держат
/// оба свойства: разные админы — разные корзины, анонимный флуд не отрезает
/// владельца, и IP в ключе не участвует.
/// </summary>
public class AdminPartitionIsolationTests
{
    private const string ProxyIp = "198.51.100.7";

    /// <summary>
    /// Запрос от аутентифицированного пользователя: id лежит в NameIdentifier,
    /// ровно как его кладёт JwtBearer при разборе токена.
    /// </summary>
    private static DefaultHttpContext AdminRequest(string ip, string? userId)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(ip);
        context.Request.Method = HttpMethods.Get;

        if (userId != null)
        {
            var identity = new ClaimsIdentity(
                new[] { new Claim(ClaimTypes.NameIdentifier, userId) }, "Bearer");
            context.User = new ClaimsPrincipal(identity);
        }

        return context;
    }

    [Fact]
    public void Admin_AuthenticatedUser_HasItsOwnBucket_AnonymousFloodCannotEmptyIt()
    {
        using var limiter = PartitionedRateLimiter.Create<HttpContext, string>(RateLimitPolicies.AdminPartition);

        // Атакующий без токена сжигает свою корзину целиком.
        const int anonymousLimit = RateLimitPolicies.AdminPermitLimit;
        var grantedAnonymously = 0;
        for (var i = 0; i < anonymousLimit + 30; i++)
        {
            using var lease = limiter.AttemptAcquire(AdminRequest(ProxyIp, userId: null));
            if (lease.IsAcquired) grantedAnonymously++;
        }

        Assert.Equal(anonymousLimit, grantedAnonymously);

        // Админ с того же адреса обязан получить свою корзину: иначе посторонний
        // флуд отрезал бы его от его же панели.
        using var ownerLease = limiter.AttemptAcquire(AdminRequest(ProxyIp, userId: "admin-1"));
        Assert.True(ownerLease.IsAcquired,
            "флуд без токена не должен отрезать админа от админских эндпоинтов");
    }

    [Fact]
    public void Admin_DifferentUsers_GetSeparateBuckets()
    {
        var first = RateLimitPolicies.AdminPartition(AdminRequest(ProxyIp, userId: "admin-1"));
        var second = RateLimitPolicies.AdminPartition(AdminRequest(ProxyIp, userId: "admin-2"));

        Assert.NotEqual(first.PartitionKey, second.PartitionKey);
    }

    [Fact]
    public void Admin_SameUserDifferentIp_SharesBucket()
    {
        // Один админ с двух сетей — одна корзина: иначе лимит обходится
        // сменой сети, а смысл лимита — ограничить аккаунт.
        var here = RateLimitPolicies.AdminPartition(AdminRequest(ProxyIp, userId: "admin-1"));
        var there = RateLimitPolicies.AdminPartition(AdminRequest("203.0.113.9", userId: "admin-1"));

        Assert.Equal(here.PartitionKey, there.PartitionKey);
    }

    [Fact]
    public void Admin_WithoutToken_StillPartitionedByIp()
    {
        // До аутентификации id нет — такие запросы делят IP-корзину. Это
        // безопасно: они всё равно получат 401/403 на [Authorize].
        var here = RateLimitPolicies.AdminPartition(AdminRequest(ProxyIp, userId: null));
        var there = RateLimitPolicies.AdminPartition(AdminRequest("203.0.113.9", userId: null));

        Assert.NotEqual(here.PartitionKey, there.PartitionKey);
        Assert.StartsWith("ip:", here.PartitionKey, StringComparison.Ordinal);
    }

    [Fact]
    public void Admin_UserIdIsHashed_NotLeakedIntoKey()
    {
        // Ключ партиции оседает в памяти процесса и в метриках — сырого id
        // пользователя там быть не должно.
        var partition = RateLimitPolicies.AdminPartition(AdminRequest(ProxyIp, userId: "secret-user-id"));

        Assert.DoesNotContain("secret-user-id", partition.PartitionKey, StringComparison.Ordinal);
        Assert.StartsWith("admin:", partition.PartitionKey, StringComparison.Ordinal);
    }
}
