using System.ComponentModel.DataAnnotations;

namespace EnglishLearningPlatform.API.Models;

/// <summary>
/// Событие воронки, которое прислал ГОСТЬ публичного /test (W2.4).
///
/// Это отдельная таблица, а не строка в `AnalyticsEvents`, и вот почему:
/// `AnalyticsEvent.UserId` — обязательный внешник на `AspNetUsers` с каскадным
/// удалением. Гостя в базе пользователей нет, поэтому либо пришлось бы
/// делать колонку nullable (тогда сломается частичный уникальный индекс
/// «одна активация на человека» и все запросы, которые считают по UserId),
/// либо заводить фейкового пользователя на каждый заход — то есть плодить
/// мусор в прод-таблице. Раздельные таблицы дешёвые, а смешивать гостевой
/// write-путь с аутентифицированным — ровно та дыра, ради закрытия которой
/// этот эндпоинт и делался отдельным.
///
/// Что лежит в записи (сознательно ничего сверх этого):
///  - `Event` — только имя из whitelist контроллера, свободных имён нет;
///  - `IpHash` — sha256 от IP с суточной солью, НЕ сам IP (см. Security/GuestIdentity);
///  - `Day` + `Hour` — сутки и час UTC. Точного времени запроса нет: для
///    воронки «сколько людей дошли до результата» минутная точность не нужна,
///    а лишняя точность — это лишний след за человеком;
///  - `DedupeKey` — случайный nonce клиента, нужен чтобы повторная отправка
///    (ретраей после обрыва, второй render эффекта) не удваивала счётчик.
///
/// Чего здесь нет: PII, email, текста ответа, UA, referer, куки, идентификатора
/// человека. `DedupeKey` случаен и живёт одну отправку, поэтому между
/// сессиями он не связывает ничего: это антидубль, а не advertising ID.
/// </summary>
public class GuestAnalyticsEvent
{
    public int Id { get; set; }

    [MaxLength(50)]
    public string Event { get; set; } = string.Empty;

    /// <summary>sha256(IP + суточный соль-ключ), hex, 64 символа. Сырой IP не пишется.</summary>
    [MaxLength(64)]
    public string IpHash { get; set; } = string.Empty;

    /// <summary>Уровень результата ('a1'…'c1'). Есть только у placement_test_completed.</summary>
    [MaxLength(10)]
    public string? Level { get; set; }

    /// <summary>Сутки UTC. Время запроса намеренно не хранится — см. час.</summary>
    public DateOnly Day { get; set; }

    /// <summary>Час суток UTC (0…23): показывает, когда качают тест, но не когда именно человек кликнул.</summary>
    public int Hour { get; set; }

    /// <summary>Случайный ключ клиента на одну отправку: гасит дубли сетевых повторов.</summary>
    [MaxLength(64)]
    public string DedupeKey { get; set; } = string.Empty;
}
