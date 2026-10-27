using System.Net;
using EnglishLearningPlatform.API.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace EnglishLearningPlatform.API.Tests.Services;

/// <summary>
/// Разбор строки прокси.
///
/// Прокси стал условием работоспособности перевода: без него Google отдаёт 429
/// на прямой запрос (проверено из процесса .NET). Поэтому ошибка в разборе
/// строки — это не «мелочь конфигурации», а отказ перевода целиком, и она
/// должна быть видна в тестах, а не только в логе.
/// </summary>
public class ProxyFactoryTests
{
    [Theory]
    [InlineData("socks5://user:pass@host.example:8000", "host.example", 8000, "socks5")]
    [InlineData("socks5h://user:pass@host.example:8000", "host.example", 8000, "socks5")]
    [InlineData("http://host.example:3128", "host.example", 3128, "http")]
    public void Разбирает_поддерживаемые_схемы(string raw, string host, int port, string scheme)
    {
        var proxy = ProxyFactory.TryCreate(raw, NullLogger.Instance);

        Assert.NotNull(proxy);
        // Uri.ToString() добавляет завершающий слеш — сравниваем части, а не строку.
        Assert.Equal(host, proxy.Address?.Host);
        Assert.Equal(port, proxy.Address?.Port);
        Assert.Equal(scheme, proxy.Address?.Scheme);
    }

    [Fact]
    public void Учётные_данные_разбираются_из_строки()
    {
        var proxy = ProxyFactory.TryCreate("socks5://alice:secret@host.example:1080", NullLogger.Instance);

        Assert.NotNull(proxy);
        var credentials = Assert.IsType<NetworkCredential>(proxy.Credentials);
        Assert.Equal("alice", credentials.UserName);
        Assert.Equal("secret", credentials.Password);
    }

    [Fact]
    public void Порт_по_умолчанию_зависит_от_схемы()
    {
        Assert.Equal(1080, ProxyFactory.TryCreate("socks5://host.example", NullLogger.Instance)?.Address?.Port);
        Assert.Equal(8080, ProxyFactory.TryCreate("http://host.example", NullLogger.Instance)?.Address?.Port);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Пустая_настройка_даёт_null(string? raw)
    {
        Assert.Null(ProxyFactory.TryCreate(raw, NullLogger.Instance));
    }

    [Theory]
    [InlineData("ftp://host:21")]
    [InlineData("ftp://user:pass@host:21")]
    public void Неподдерживаемая_схема_даёт_null_а_не_исключение(string raw)
    {
        // Главное: строка в конфиге не должна ронять запрос сервиса.
        Assert.Null(ProxyFactory.TryCreate(raw, NullLogger.Instance));
    }

    [Fact]
    public void Мусорная_строка_не_бросает_исключение()
    {
        Assert.Null(ProxyFactory.TryCreate("это не url", NullLogger.Instance));
    }
}
