# Security Report — 2026-10-22

**Проект:** EnglishLearningPlatform (ASP.NET Core 10 API + Next.js 14 frontend)
**Ветка:** `security-fix-2026-10-22` (от `design/unify-tokens`)
**Коммиты:** 10 локальных, **push не выполнялся**
**Итог:** полный тестовый прогон зелёный (79/79), все изменения закоммичены.

---

## 1. Как проверялись изменения

### Проблема среды

На этой Windows-машине `dotnet test` падает до запуска тестов: `testhost.x86` получает
`Win32Exception (5) Access denied` при открытии handle родительского процесса
(`DefaultEngineInvoker.SetParentProcessExitCallback`). Воспроизводится из Git Bash,
PowerShell и через WMI — ограничение окружения, не проекта (логи в
`EnglishLearningPlatform.API.Tests/test-out.log` от 2026-10-20).

**Обход:** полный прогон в официальном контейнере `mcr.microsoft.com/dotnet/sdk:10.0`
на чистой сборке (не собирать параллельно с правкой файлов — иначе MSBuild может
оставить неполный output и testhost не стартует).

```bash
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "C:/Users/Nikita/Desktop/EnglishLearningPlatform:/src" \
  -e ConnectionStrings__DefaultConnection="Host=localhost;Port=5432;Database=english_learning_test;Username=appuser;Password=apppass123" \
  -e Jwt__Key="test-secret-key-for-ci-min-32-chars!!" \
  -e Jwt__Issuer="TestIssuer" -e Jwt__Audience="TestAudience" \
  -w /src mcr.microsoft.com/dotnet/sdk:10.0 bash -lc \
  "rm -rf EnglishLearningPlatform.API/bin EnglishLearningPlatform.API/obj \
          EnglishLearningPlatform.API.Tests/bin EnglishLearningPlatform.API.Tests/obj && \
   dotnet test EnglishLearningPlatform.API.Tests/EnglishLearningPlatform.API.Tests.csproj --verbosity minimal"
```

### Результат финального полного прогона

```
Passed!  - Failed: 0, Passed: 79, Skipped: 0, Total: 79, Duration: 2 s
           - EnglishLearningPlatform.API.Tests.dll (net10.0)
```

### TDD-цикл

Каждый фикс начинался с падающего теста (RED наблюдался вживую, включая
временное отключение защиты для проверки чувствительности теста), затем
реализация и GREEN. Первая волна: 17 RED → 24 GREEN. Вторая волна: 19 новых
тестов, все зелёные. Финальный набор: **79/79**.

---

## 2. Первая волна: топ-3

### 2.1. Слабая аутентификация админских endpoint'ов (`X-Seed-Key`)
**OWASP A01 + A07, High** — коммит `9aa50e6`

Непостоянное по времени сравнение ключа (тайминг-оракул), отсутствие rate limiting,
фолбэк `Feedback:AdminKey` → `Seeder:Key` (ключ контентных сидов открывал личные отзывы).
Исправлено: `AdminKeyGuard` (SHA-256 + `FixedTimeEquals`), политика `admin` (10/5 мин),
отдельный `Feedback:AdminKey` без фолбэка. Тесты: 16.

### 2.2. Stored XSS через HTML теории грамматики
**OWASP A03, High** — коммит `e557de2`

`TheoryHtml` отдавался без очистки и рендерился через `dangerouslySetInnerHTML`.
Исправлено: allowlist-санитайзер `TheoryHtmlSanitizer` (HtmlSanitizer) на выдаче API.
Тесты: 4 (script/события/javascript: удаляются, безопасная разметка сохраняется).

### 2.3. Broken access control на сводке аналитики
**OWASP A01, Medium–High** — коммит `a6ed562`

`GET /api/analytics/summary` был доступен любому JWT. Теперь — админ-ключ + rate limit.
Тесты: 4.

---

## 3. Вторая волна: найдено и исправлено дальше

### 3.1. Нет блокировки после неудачных входов (брутфорс)
**OWASP A07, High** — коммит `8a9297c`

`CheckPasswordAsync` не считает неудачи: пароль можно было перебирать бесконечно
(ограничение только 10 запросов/мин на IP). Добавлено: `IsLockedOutAsync` → 401,
`AccessFailedAsync` на неудачу, сброс счётчика на успех, опции Identity (5 попыток /
5 минут), нейтральное сообщение (не раскрывает блокировку). Тесты: 3
(пятая неудача блокирует даже верный пароль; успех сбрасывает счётчик).

### 3.2. Отсутствие защитных HTTP-заголовков
**OWASP A05, Medium** — коммит `8a9297c`

`SecurityHeadersMiddleware`: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`,
`Cross-Origin-Resource-Policy: same-site`. `nosniff` важен для `/uploads/covers`:
обложка из EPUB сохраняется как `.jpg`, и без заголовка браузер мог досниффить HTML.
Тест: 1.

### 3.3. EPUB decompression bomb и безлимитный кэш текста книг
**DoS, Medium–High** — коммит `9992025`

50 МБ сжатого EPUB могли развернуться в гигабайты при `EpubReader.ReadBookAsync`;
разобранный текст кэшировался без ограничений. Добавлено: проверка zip до парсинга
(≤ 50 МБ на запись, ≤ 150 МБ суммарно, ≤ 5000 записей), книги > 2 млн символов
не кэшируются целиком. Тесты: 7.

### 3.4. Кросс-пользовательская правка общих слов словаря
**OWASP A01 (data integrity), Medium** — коммит `20fd803`

`Words` — глобальная таблица: правка слова одним пользователем меняла перевод
всем. Реализован copy-on-write: если слово используется другими, редактор получает
личную копию, его `UserWord` переключается на неё. Дополнительно ужесточён
валидатор текста при обновлении. Тесты: 2.

### 3.5. Неограниченная память reading-сессий
**DoS, Medium** — коммиты `e5a390e`, `fe92415`

Сессии живут в `IMemoryCache` без лимитов. Добавлено: ≤ 1000 различных слов
в сессии (дубликаты идемпотентны), ≤ 20 активных сессий на пользователя
(самая старая вытесняется вместе с данными), ≤ 100 символов на слово. Тесты: 4.

### 3.6. Email-бомбинг через сброс пароля и подтверждение email
**OWASP A04 (abuse), Medium** — коммит `ab66d35`

Оба письма можно было запрашивать повторно (только IP-лимит), засыпая чужой ящик.
Добавлен кулдаун 5 минут на адрес для `forgot-password` и `resend-confirmation`;
ответы остаются нейтральными. Тесты: 2 (повторный вызов не создаёт второе письмо).

### 3.7. Лимиты на тяжёлые endpoint'ы и гигиена репозитория
Коммиты `8a9297c`, `dc4638e`

- Rate limit `upload` (10/5 мин) на загрузку EPUB и аватара; `analytics` (120/мин).
- `.qoder/`, `.taste-skill/`, `prompt-tunnel-brother.md` добавлены в `.gitignore`:
  QA-скрипты содержат plaintext-пароли тестовых аккаунтов и не должны попасть
  в публикацию.

---

## 4. Осталось неисправленным (следующий прогон)

Приоритет сверху вниз. Первые два пункта требуют решения, которое нельзя
безопасно автоматизировать (мажорный апгрейд / коммерческая лицензия).

1. **SixLabors.ImageSharp 3.1.12 — high-адвизори (NU1903):** GHSA-jjfr-hcj7-qf5w,
   GHSA-j3p4-wp97-rph4, GHSA-j9gm-c75j-xc9q; moderate: GHSA-wmxv-xphr-5c9g,
   GHSA-gwg2-r3hj-4w44. Библиотека декодирует пользовательские аватары.
   Фиксы только в 4.x, а 4.x требует коммерческую лицензию. Варианты: покупка
   лицензии / смена декодера / ужесточение `AvatarService` (`Image.Identify`
   с лимитом пикселей и памяти до `Image.LoadAsync`).
2. **Next.js 14.2.35 — critical по `npm audit` (DoS):** GHSA-h25m-26qc-wcjf (7.5)
   и др., исправления в 15.5.10+/15.5.14+. Апгрейд 14 → 15/16 тянет React 19;
   нужен отдельный спринт с ручной проверкой UI (фронтенд без тестов).
3. **Rate limiting за прокси.** `RemoteIpAddress` на Render — адрес прокси,
   поэтому все клиенты делят одну партицию: один атакующий может исчерпать
   лимит логина для всех. Нужно включить `ForwardedHeaders` (X-Forwarded-For)
   и доверять только прокси платформы; конфигурация зависит от топологии деплоя.
4. **Клиент доверяет результатам практики (Low).** `SubmitDictation` принимает
   `Correct` от клиента, `SubmitWriting` — `WordCount`; XP начисляется по этим
   данным (дневные капы ограничивают ущерб). Фикс требует смены контракта API
   и фронтенда (серверная проверка введённого текста).
5. **JWT живёт 7 дней без отзыва (Low).** `Jwt:ExpiryMinutes = 10080`. Для
   публичного релиза — короткий access-token + refresh/revocation.
6. **Админ-ключ отзывов в `sessionStorage` (Low).** После фикса XSS риск снижен,
   но ключ лучше не персистить (или отдавать админку через httpOnly-cookie).
7. **`ReadingDifficultyService.UserVersions` — статический словарь без очистки
   (Low).** Растёт с числом пользователей, которые отмечают слова.
8. **`WordListsController.LearnWords` — текст слов не ограничен по длине (Low).**
   До 500 слов за запрос без `MaxLength`; стоит добавить те же 100 символов.
9. **Гигиена:** dev-пароль Postgres в `docker-compose.yml` (только локально);
   QA-пароли в `.taste-skill` (теперь в `.gitignore`, но при утечке архива —
   сменить); `/uploads/covers` публичны осознанно.

---

## 5. Проверено и признано корректным

- `FilesController`: аватары/EPUB только владельцу, имена валидируются.
- `AvatarService`: magic bytes, лимит 2 МБ, перекодирование (оригинал не сохраняется).
- `PopularBooksService`: whitelist Gutenberg ID, SSRF исключён.
- `ResilientAiService`: URL константный, ключи только из конфига, в логи не попадают.
- SQL: нет `FromSqlRaw`; EF Core LINQ с параметризацией; ILIKE-параметры экранируются.
- `GlobalExceptionHandler`: в Production не отдаёт stack trace.
- `FeedbackController.Submit`: honeypot, лимиты, защита от header injection в теме.
- Frontend `/api/avatar/[name]`: regex-валидация имени + проверка сессии NextAuth,
  дальше — owner-check в API (IDOR закрыт).

---

## 6. Команды для воспроизведения

```bash
git checkout security-fix-2026-10-22
git log --oneline -10
# fe92415 Security: Reject oversized words in reading sessions
# ab66d35 Security: Throttle password-reset and confirmation emails per address
# dc4638e Security: Keep local secret-bearing tooling out of git
# e5a390e Security: Cap reading session memory usage
# 20fd803 Security: Fix cross-user mutation of shared dictionary words
# 9992025 Security: Reject EPUB decompression bombs and cap cached book text
# 8a9297c Security: Add login lockout, defensive headers and endpoint rate limits
# a6ed562 Security: Fix broken access control on analytics summary
# e557de2 Security: Fix stored XSS via unsanitized grammar theory HTML
# 9aa50e6 Security: Fix weak admin key authentication on admin endpoints

# Полный прогон — только в контейнере (см. раздел 1):
# Passed! Failed: 0, Passed: 79, Skipped: 0, Total: 79
```

Отчёт создан после коммитов и намеренно не закоммичен: в рабочем дереве только
этот файл (untracked).
