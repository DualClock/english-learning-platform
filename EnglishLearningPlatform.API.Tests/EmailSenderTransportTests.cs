using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearningPlatform.API.Tests;

/// <summary>
/// Выбор транспорта почты и формат запроса Brevo.
///
/// Причина появления файла: на VPS хостер держит исходящие SMTP-порты закрытыми
/// (проверено с самого сервера: 25/465/587 до Яндекса, Gmail и релея хостера —
/// таймаут, при этом 443 работает). Значит письмо обязано уметь уходить через
/// HTTP-API, а решение «куда именно» нельзя оставлять разбросанным по коду.
///
/// Сеть здесь не трогается намеренно: проверяется выбор транспорта, формулировка
/// причины отказа и форма payload — то есть ровно то, что ломает доставку, когда
/// в конфиге опечатка.
/// </summary>
public class EmailSenderTransportTests
{
    [Theory]
    [InlineData("brevo", "x", "", "", "", "brevo")]
    [InlineData("Brevo", "x", "smtp.yandex.ru", "u", "p", "brevo")]
    [InlineData("  brevo  ", "x", "", "", "", "brevo")]
    [InlineData("brevo", "", "smtp.yandex.ru", "u", "p", "smtp")]
    [InlineData("brevo", "", "", "", "", "log")]
    [InlineData("", "", "smtp.yandex.ru", "u", "p", "smtp")]
    [InlineData(null, null, "smtp.yandex.ru", null, null, "smtp")]
    [InlineData("", "", "smtp.yandex.ru", "u", "", "log")]
    [InlineData("", "", "", "u", "p", "log")]
    [InlineData("sendgrid", "x", "", "", "", "log")]
    public void ResolveTransport_выбирает_то_что_настроено(
        string? provider, string? key, string? host, string? user, string? password, string expected)
        => Assert.Equal(expected, EmailSender.ResolveTransport(provider, key, host, user, password));

    [Fact]
    public void Brevo_без_ключа_объясняет_именно_это_а_не_отсутствие_Smtp()
    {
        var reason = EmailSender.ExplainLogOnly("brevo", "", "smtp.yandex.ru", "u", "p");

        Assert.Contains("Email:Brevo:ApiKey", reason);
        Assert.DoesNotContain("не задан пароль", reason);
    }

    [Fact]
    public void Smtp_без_хоста_попрежнему_называется_в_объяснении()
    {
        Assert.Contains("SMTP не настроен", EmailSender.ExplainLogOnly("", "", "", "", ""));
        Assert.Contains("не задан пароль", EmailSender.ExplainLogOnly("", "", "smtp.yandex.ru", "u", ""));
    }

    [Fact]
    public void Payload_Brevo_ожидает_отправителя_получателя_и_текст()
    {
        var json = EmailSender.BuildBrevoPayload(
            "no-reply@lexicon.local", "Lexicon", "reader@example.com", "Подтверждение email — Lexicon", "Открой ссылку");

        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal("Lexicon", root.GetProperty("sender").GetProperty("name").GetString());
        Assert.Equal("no-reply@lexicon.local", root.GetProperty("sender").GetProperty("email").GetString());
        Assert.Equal("reader@example.com", root.GetProperty("to")[0].GetProperty("email").GetString());
        Assert.Equal("Подтверждение email — Lexicon", root.GetProperty("subject").GetString());
        Assert.Equal("Открой ссылку", root.GetProperty("textContent").GetString());
    }

    [Fact]
    public void Payload_переживает_кавычки_переносы_и_не_содержит_ключа()
    {
        var json = EmailSender.BuildBrevoPayload(
            "a@b.co", "Lex", "c@d.co", "тема \"в кавычках\"", "строка1\r\nстрока2 \\ слэш");

        using var doc = System.Text.Json.JsonDocument.Parse(json);

        Assert.Equal("тема \"в кавычках\"", doc.RootElement.GetProperty("subject").GetString());
        Assert.Equal("строка1\r\nстрока2 \\ слэш", doc.RootElement.GetProperty("textContent").GetString());
        Assert.DoesNotContain("api-key", json.ToLowerInvariant());
    }

    [Fact]
    public async Task Без_адреса_отправителя_Brevo_отказывается_не_дёргая_провайдера()
    {
        await using var context = CreateContext();
        var sender = new EmailSender(
            context,
            Config(("Email:Provider", "brevo"), ("Email:Brevo:ApiKey", "secret-key"), ("Email:From", "")),
            NullLogger<EmailSender>.Instance);

        var result = await sender.SendAsync(null, "reader@example.com", "тема", "тело", "confirm-email");

        Assert.False(result.Delivered);
        Assert.Equal("brevo", result.Transport);
        Assert.Contains("Email:From", result.Error);

        var journaled = await context.EmailMessages.SingleAsync();
        Assert.False(journaled.Delivered);
        Assert.Equal("brevo", journaled.Transport);
    }

    [Fact]
    public async Task Ни_Smtp_ни_ключа_письмо_уходит_в_журнал_с_новым_текстом_причины()
    {
        await using var context = CreateContext();
        var sender = new EmailSender(
            context,
            Config(("Email:Provider", "brevo"), ("Email:Brevo:ApiKey", "")),
            NullLogger<EmailSender>.Instance);

        var result = await sender.SendAsync(null, "reader@example.com", "тема", "тело", "feedback");

        Assert.False(result.Delivered);
        Assert.Equal("log", result.Transport);
        var journaled = await context.EmailMessages.SingleAsync();
        Assert.Contains("Email:Brevo:ApiKey", journaled.Error);
    }

    [Fact]
    public async Task Пустой_получатель_не_уезжает_ни_в_один_транспорт()
    {
        await using var context = CreateContext();
        var sender = new EmailSender(
            context,
            Config(("Email:Provider", "brevo"), ("Email:Brevo:ApiKey", "k"), ("Email:From", "a@b.co")),
            NullLogger<EmailSender>.Instance);

        var result = await sender.SendAsync(null, "", "тема", "тело", "confirm-email");

        Assert.Equal("log", result.Transport);
        Assert.Contains("не указан email", result.Error);
    }

    private static ApplicationDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static IConfiguration Config(params (string Key, string Value)[] values)
    {
        var map = values.ToDictionary(v => v.Key, v => (string?)v.Value);
        return new ConfigurationBuilder().AddInMemoryCollection(map).Build();
    }
}
