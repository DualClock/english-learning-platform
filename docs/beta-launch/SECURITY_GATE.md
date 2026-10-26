# Security-гейт перед публичной бетой

Дата проверки: 23.10.2026. Основано на `Security_Report_2026-10-22.md` + повторном read-only
разборе кода и командах `npm audit --omit=dev`, `dotnet list package --vulnerable`.
Ничего из этого списка не трогал в коде — это задачи на разработку, а не заметки.

## 0. Блокер нулёвого уровня: непонятно, что вообще живёт в проде

- Локальная ветка `security-fix-2026-10-22` — **на 81 коммит впереди `origin/main` и на 0
  позади** (проверено `git rev-list --left-right --count origin/main...HEAD`). Push не
  выполнялся ни разу.
- В репозитории два CI-воркфлоу (`.github/workflows/backend-ci.yml`, `frontend-ci.yml`),
  но ни одного деплой-воркфлоу нет. `render.yaml` описывает API на Render **free-плане**,
  `DEPLOY.md` ведёт фронтенд на Vercel, а прод, по твоим прошлым словам, живёт на Timeweb.
  То есть в репозитории нет ответа на вопрос, какая конфигурация реально обслуживает
  пользователей и из какой ветки она собирается.

**Последствие:** если прод собирается из `main`, то десять security-фиксов (lockout,
admin-key, XSS-санитайзер, EPUB-бомбы, rate limiting, защитные заголовки) в проде отсутствуют,
и мы зовём незнакомых людей в приложение с известными дырами. **Запрещается публикация ссылок
из outreach-ките, пока этот пункт не закрыт.**

Признак выполнения: назван публичный URL, указан SHA задеплоенной сборки, `git merge-base
--is-ancestor 9aa50e6 <DEPLOYED_SHA>` возвращает 0 для всех десяти security-коммитов, а
`/health` отвечает с этого URL.

## 1. Пять рисков, которые закрываем до первой ссылки

**1.1 Critical — известные CVE в проде: `next@14.2.35` и `next-auth@4.24.11`.**
`npm audit --omit=dev` (23.10.2026): 4 уязвимости, из них 2 critical, включая RCE в
Image Optimization (`/_next/image`). Фиксы — в Next 15.5.10+/16.x и next-auth ≥4.24.15.
Апгрейд 14 → 15/16 тянет React 19 и не покрыт тестами фронта.
*Если апгрейд не успеваем к дате:* закрыть `/_next/image` на reverse-proxy, выключить
оптимизацию изображений (`images.unoptimized`), задеплоить canary и вручную проверить
логин, `/api/avatar/[name]`, `/api/word-image/[name]` и читалку.
*Почему до беты:* на публичный URL с RCE-вектором приходит бот-сканер, а не человек, —
и приходит в первый же день.

**1.2 Critical — секреты могут попасть в образ.**
`.dockerignore` (проверено содержимое) не исключает `appsettings.Development.json`, а
`Dockerfile:8` делает `COPY EnglishLearningPlatform.API/ ./`. При локальной сборке образа
(что и есть путь деплоя на Timeweb) dev-конфиг с рабочими JWT/Gemini/proxy-кредентами
уезжает в слой образа. `DEPLOY.md:22-29` прямо утверждает, что рабочие ключи когда-то лежали
в истории; мой поиск по 84 коммитам по типовым маскам живых ключей ничего не нашёл, но это
не доказательство.
*Действие:* добавить `appsettings.Development.json` и `.env*` в `.dockerignore`, почистить
`bin/`, ротировать JWT-ключ, Gemini-ключ, адрес прокси и `NEXTAUTH_SECRET`, поставить
gitleaks/trufflehog в CI, проверить, что продовый `Jwt__Key` ≠ локальный.

**1.3 High — JWT живёт 7 дней, отзыва нет, CSP нет.**
`Jwt:ExpiryMinutes = 10080` (`appsettings.json:9-10`), refresh 60 дней, logout и смена пароля
токены не инвалидируют (`AuthController.cs:171-228`). На фронтенде нет ни CSP, ни
`X-Frame-Options`, ни `nosniff`, ни HSTS: `frontend/next.config.mjs:1-11` и `vercel.json`
без `headers()`. Один XSS + отсутствие CSP = украденный на неделю bearer-токен.
*Действие:* access-token 15–60 мин + refresh с отзывом и инвалидацией при смене пароля;
`headers()` в Next с CSP (`frame-ancestors 'none'`), `X-Frame-Options`, `nosniff`,
`Referrer-Policy`, HSTS; на API — то же, плюс HSTS (сейчас `SecurityHeadersMiddleware.cs:17-21`
отдаёт пять заголовков без HSTS/CSP).

**1.4 High — rate limiting за прокси ломается в общую сторону.**
`UseForwardedHeaders` в коде отсутствует, `UseHttpsRedirection` закомментирован
(`Program.cs:287`), политики лимитов есть (`Program.cs:144-206`) но партицируются по
`RemoteIpAddress`, который за Timeweb/Render = адрес прокси. Один скрипт-перебор выжигает
лимит логина для всех бета-тестеров одновременно, а lockout (5 попыток) превращается в
DoS собственными руками.
*Действие:* включить ForwardedHeaders с доверием только сетям твоего прокси, ключевать
лимиты по IP **и** по аккаунту, руками проверить, что 429 получает один клиент, а не все.

**1.5 High — открытая регистрация + AI-квота 300 запросов/день на аккаунт.**
`EmailConfirmed` при логине не проверяется (`AuthController.cs:114-165`), регистрация
публична, квота считается в `AiQuotaService.cs:36`. Disposable-аккаунты выжигают Gemini-бюджет
и твою почту (SMTP-лимиты) за сутки. Это ещё и финансовый риск, а не только безопасностный.
*Действие:* подтверждение email обязательно до любых AI-endpoint'ов, глобальный дневной
бюджет запросов с алертом, invite-код на AI-функции первой недели, капча или honeypot на
регистрации. Побочный плюс: инвайты превращаются в реферальную механику набора (см. план).

## 2. Из прошлого отчёта осталось незакрытым (подтверждено в коде)

- Клиент сам сообщает результат практики: `Correct` в `PracticeController.cs:101-115` и
  `WordCount` в `:132-134` → XP начисляется по данным браузера. Для беты это не катастрофа
  (дневные капы есть), но ломает любую метру «сколько они реально учились». **Для нас это
  важно именно как метрика**: если XP накручивается, когортные цифры неверны.
- `SixLabors.ImageSharp 3.1.12` — 3 high + 2 moderate, декодирует пользовательские аватары;
  фиксы только в платной 4.x. На бету проще отключить загрузку аватаров, чем покупать лицензию.
- Статический `UserVersions` в `ReaderDifficultyService.cs:39` растёт без очистки;
  `MaxLength` на текст слова в `WordListsController.cs:142,249` отсутствует.
- Кулдауны email и счётчики in-memory: сбрасываются рестартом и не общие для инстансов.
- CI: нет `dependabot.yml`, нет secret-scan и audit-шагов, `npm install` вместо `npm ci`,
  во фронтенд-воркфлове вызывается `npm test`, которого в `package.json` нет (есть `test:unit`).

## 3. Regularный Security Sentinel (режим после запуска)

**Перед каждым релизом (гейт, 15–20 минут, блокирующий):**
чистое `git status` → SHA собранного образа содержит security-коммиты →
`npm audit --omit=dev --audit-level=high` → `dotnet list package --vulnerable
--include-transitive` → gitleaks по дереву и истории → проверка `.dockerignore` →
смоук-тесты на проде: логин и lockout, admin-endpoint без ключа = 401/403, CORS с чужого
origin, 429 за прокси, `/health`, защитные заголовки. Critical/High = релиз не едет.

**Раз в неделю (30 минут, неблокирующий):**
триаж Dependabot (minor/patch группами), повторный audit, поиск новых `[AllowAnonymous]`,
новых загрузок файлов и новых `dangerouslySetInnerHTML`, всплески 401/403/429/5xx в логах,
расход AI-квоты за неделю.

**Раз в месяц:**
ротация ключей, чеклист OWASP Top-10/ASVS L1, ревизия доступов (Timeweb, Render, Vercel,
Neon, GitHub), тест восстановления БД, OWASP ZAP baseline **только по собственному
staging-домену** с allowlist и вне часов активности, securityheaders.com и Lighthouse по нему же.

**Артефакты:** `security/risk-register.md` (ID, актив, severity, evidence со ссылкой на
file:line или вывод команды, владелец, срок, статус), `security/evidence/<дата>/` с
обезличенными логами, fix-PR с тестом и планом отката, release sign-off. Принятый риск —
только с датой пересмотра, иначе он становится вечным.

**Внешние сканы.** Активные тесты на чужой инфраструктуре — только по доменам, которые
принадлежат тебе, и только по rules of engagement, которые ты сам зафиксировал. ZAP baseline
по своему staging — можно; скан продакшена в часы активности когорты — нельзя, потому что
ты устроишь DoS собственным бета-тестерам.

## 4. Проверено и признано корректным (не трогать без причины)

`AdminKeyGuard` (SHA-256 + `FixedTimeEquals`, fail-closed в проде,
`Security/AdminKeyGuard.cs:14-38`), санитайзер `TheoryHtml` (`Services/TheoryHtmlSanitizer.cs:10-16`),
lockout (`Program.cs:88-90`, `AuthController.cs:127-144`), лимиты EPUB-архивов
(`Services/BookService.cs:21-31,62-70,138-170`), copy-on-write словаря
(`Services/DictionaryService.cs:283-324`), IDOR на файлах, SSRF в `PopularBooksService`,
параметризованный EF без `FromSqlRaw`, `GlobalExceptionHandler` без stack trace в Production.
