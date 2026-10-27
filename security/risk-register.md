# Risk register — Lexicon, бета-запуск (W1.3 независимый аудит)

**Аудитор:** W1.3 Security Auditor (независимая проверка, режим «доверяется не отчёту, а коду»)
**Дата:** 23.10.2026 · **Ветка:** `release/beta` @ `7c2bc4c` · **Дистанция:** `origin/main` @ `d749512`
**Область:** коммиты `3b8cb29..HEAD` (24eff1a, 5ad5875, c0c8427, 9322697, 1b1c8c9, 7c2bc4c) + отдельная проверка публичного репозитория и ключа подписи JWT.

**Снимок аудита (важно для пересмотра):** все выводы сделаны по коммиту `7c2bc4c`. На момент завершения проверки в рабочем дереве уже висели **чужие незакоммиченные правки** (`AnalyticsController.cs`, `ApplicationDbContext.cs`, `Migrations/…AddFirstChapterActivationIndex`, `frontend/src/app/reader/[id]/page.tsx`) от параллельной задачи W2.1.3, а `git ls-remote` показывает `origin/main = d749512` ≠ локальный HEAD (навык `site-audit` зафиксировал это как PIPE-6 fail). Я ничего из кода не менял — единственный созданный мной файл это этот реестр. Но значит: то, что будет запущено в прод, ≠ то, что я проверил; перед invite реестр нужно перепроверить на финальном коммите, а прогон 135/135 относится к дереву на момент 16:4x UTC, когда я его запускал.

**Шкала severity** (CVSS-подобная,+self вектор в скобках): `Critical ≥ 8.5` · `High 7.0–8.4` · `Medium 4.5–6.9` · `Low < 4.5`.
**Статусы:** `fixed` — проверено мной в коде и работает как заявлено · `accepted` — принято с датой пересмотра · `open` — не закрыто.

---

## Реестр

| ID | Актив | Severity | Evidence | Статус | Срок пересмотра | Действие |
|---|---|---|---|---|---|---|
| **R-01** | Подпись JWT/identities всех бета-тестеров; репозиторий на GitHub | **High 7.7** (AV:N/AC:L/PR:N/UI:N/C:H/I:H/A:N) — эскалация до **Critical 9.4**, если живой ключ попадёт в push | `api.github.com/repos/DualClock/english-learning-platform` → `"private": false, "visibility": "public"` (мой curl). `EnglishLearningPlatform.API/appsettings.json:6` → `Jwt:Key = "SET_IN_ENV_min_32_chars_secret_key"` (34 симв. = ровно минимум, поэтому «ненулевое»). Guard: `Program.cs:102-110` — старт вне Development запрещён при пустом ключе, префиксе `SET_IN_ENV` или длине <32. Подпись одна симметричная, HS256, `Program.cs:172`; kid/ротации/revocation-списка нет; одним ключом подписаны и access, и refresh (`Controllers/AuthController.cs:377-378, 400-401`). Живой 88-симв. `Jwt:Key` (`rot-2026-10-20:…`), живой Gemini-ключ и SOCKS5 `user:pass@host` лежат в `appsettings.Development.json`, защищённом **только** строкой `.gitignore:47`; `DEPLOY.md:114` прямо велит человеку «взять локально» и вставить в Render | **open** | 27.10.2026 (до push) | 1) Вынести живые креды из `appsettings.Development.json` в user-secrets/менеджер паролей; файл удалить с диска после переноса. 2) Ввести ротацию: `Jwt:Key` + `Jwt:PreviousKeys[]`, kid в заголовке, отозвать все токены, выпущенные до деплоя. 3) Убрать из `DEPLOY.md` инструкцию копировать секрет руками. 4) До push прогнать `gitleaks detect` (я прогнал — чисто) и `git status --ignored`, убедиться, что ни один ignore-путь не попадает в индекс |
| **R-02** | Публичная регистрация (фронт-дверь беты) | **High 7.5** (AV:N/AC:L/PR:N/UI:N/C:N/I:N/A:H) — фактически блокирует запуск | `Security/RateLimitPolicies.cs:56-66` → `signup` = 5/час на `IpOnly`. `render.yaml` не содержит `Proxy__TrustedCidrs` (grep по репо: ключ встречается только в `Program.cs:153`, `Security/TrustedProxySetup.cs:11` и тестах) → `TrustedProxySetup.Configure` при пустом значении ставит `ForwardedHeaders = None` (`TrustedProxySetup.cs:29-36`), `RemoteIpAddress` = адрес LB Render для **всех** → одна партиция на планету. Я проверил приоритет атрибутов эмпирически (scratch-проект в контейнере `dotnet/sdk:10.0`, см. «Проверено лично»): action-атрибут перебивает controller-атрибут → `/api/auth/register` лимитится именно `signup` (5/ч), а не `auth` (10/мин) | **fixed (W1.4.1+W1.4.2, 663838a + follow-up)** · остаток: **значение** `Proxy__TrustedCidrs` | 27.10.2026 (до invite) | Задать `Proxy__TrustedCidrs` сетями Render (или `Proxy__TrustFirstHop=…`-эквивалент) ИЛИ поднять `signup` до 30/час с отдельным global-лимитом на хост. Добавить в `render.yaml` явной строкой. До фикса — не рассылать ссылку на регистрацию: первые же 5 заявок исчерпают часовой бюджет. **Что сделано W1.4:** `signup` переставлен на партицию по нормализованному email (5/час на адрес) + отдельный per-IP кап 50/час в `GlobalLimiter` только на `POST /api/auth/register` + суточный кап всего сервиса `Registration:DailyGlobalLimit` (500; WARNING на 80%, 429 на 100%, счётчик по `Users` за UTC-сутки в Postgres, поэтому переживает рестарт инстанса). `Proxy__TrustedCidrs` объявлен в `render.yaml` (`sync: false`), в `appsettings.json` и в таблице переменных `DEPLOY.md`, а если он пуст при IP-партицированных лимитах — `BareProxyGuard` пишет WARNING на старте (проверено живым запуском API в контейнере: предупреждение есть при пустом значении и его нет при `Proxy__TrustedCidrs=10.0.0.0/24`). Не закрыто владельцем: конкретные CIDR сетей Render, из которых LB ходит в origin, — их надо померить на первом живом окружении, в реестре это остаётся пунктом R-03 |
| **R-03** | Транспортная безопасность API (HSTS из A4) | **Medium 5.3** (AV:N/AC:H/PR:N/UI:N/C:L/I:N/A:N) — заявленный фикс **не действует** в planned deployment | `Middleware/SecurityHeadersMiddleware.cs:28-30` — HSTS выдаётся только `if (context.Request.IsHttps)`. `IsHttps` ≡ `Request.Scheme == "https"`, а Scheme становится `https` только через `X-Forwarded-Proto`, который игнорируется при `ForwardedHeaders.None` (см. R-02). `app.UseHttpsRedirection()` закомментирован (`Program.cs:241`). Тест `SecurityHeadersHstsCspTests.cs:20` выставляет `context.Request.Scheme = "https"` руками — он доказывает логику middleware, но не то, что заголовок доезжает до клиента на Render | **open** | 27.10.2026 | Настроить `Proxy__TrustedCidrs` (общий корень с R-02), затем проверить живым `curl -sI https://<api>/health -H 'X-Forwarded-For: 1.2.3.4'` → ждать `Strict-Transport-Security`. Заодно проверить, что `max-age=31536000; includeSubDomains` не оставит ловушку на домене провайдера (`*.onrender.com` — чужая зона, subdomain-политика влияет не на вас) |
| **R-04** | `/api/auth/login`, `/forgot-password`: защита от брутфорса и перебора аккаунтов | **High 7.4** (AV:N/AC:L/PR:N/UI:N/C:L/I:L/A:N) — **регрессия, внесённая A5** | `Security/RateLimitPartitionKeys.cs:22-27` → ключ `sha256(RemoteIp + "\|" + email)`. Email читается из тела запроса, поэтому атакующий сам выбирает партицию: 10 000 разных email в 10 000 разных корзин по 10/мин = неограниченный credential-stuffing и перечисление существующих аккаунтов. Раньше (до `9322697`) был `auth` = 10/мин на IP, что ограничивало суммарный поток. Агрегирующего per-IP лимита поверх партиции не добавлено: `RateLimitPolicies.cs:18-35` объявляет только `auth`/`admin`/`signup`/`feedback`/`upload`/`analytics`, каждая политика — одна партиция, без каскада | **open** | 28.10.2026 | Оставить `IP+email` для изоляции жертвы, но **добавить второй, агрегирующий по IP лимитер** (например 30 разных email/час с одного IP) и счётчик неуникальных email в партиции. Плюс: `signup` (R-02) и `auth` не защищают `/api/auth/refresh`, у которого `[EnableRateLimiting]` нет вовсе |
| **R-05** | Админские поверхности (`/admin/feedback`, аналитика, сиды) | **Medium 5.4** (AV:N/AC:L/PR:N/UI:N/C:N/I:N/A:H для владельца) | `Security/RateLimitPolicies.cs:44-54` → `admin` = `Identity(context)` = `sha256(ip + email)`, но тела админ-запросов поля `email` не содержат (`RateLimitPartitionKeys.cs:64-77` → пустая строка), а GET вообще не инспектируется (`:33-36`). Итог: одна константная корзина на 10 запросов / 5 мин для **всего мира**. Это `AnalyticsController.cs:88`, `CategoriesController.cs:178`, `FeedbackController.cs:148`, `GrammarController.cs:33`, `WordListsController.cs:103`. Кто угодно может выжечь её и закрыть владельцу доступ к отзывам беты | **open** | 28.10.2026 | Для `admin` использовать `IpOnly` + отдельный счётчик по значениям `X-Admin-Key`/`Seeder__Key` (партиция по префиксу ключа), чтобы владелец не делил корзину с атакующим. В тесте `RateLimitPartitionTests.cs:138` проверено только то, что партиция совпадает с auth-партицией, — то есть дефект зафиксирован как «ожидаемое поведение» |
| **R-06** | Дневной бюджет Gemini — полнота email-gate (A6) | **Medium 6.3** (AV:N/AC:L/PR:L/UI:N/C:N/I:N/A:L) | Гейт `[RequireConfirmedEmail]` стоит ровно на 4 контроллерах (`grep -rn RequireConfirmedEmail`: `AiController.cs:13`, `AssistantController.cs:14`, `AudioController.cs:12`, `PronunciationController.cs:12`). **`Controllers/BooksController.cs:17` имеет только `[Authorize]`**, а `BooksController.cs:377-395` (`GET /api/books/{id}/parallel`) вызывает `TranslateChunksAsync` → `AiService.TranslateLiteraryAsync` (`:413`) → Gemini. Неписаный-подтверждённый аккаунт получает платный вызов на страницу книги. Тест-«страховка» `RegistrationAndAiQuotaTests.cs:126-133` перебирает **захардкоженный список из 4 типов**, поэтому BooksController ему не виден в принципе | **fixed (W1.4.3)** | 28.10.2026 | `[RequireConfirmedEmail]` на `BooksController.GetParallelPage` (или на весь контроллер, кроме GET-метаданных). Тест переписать на рефлексию: «любой контроллер, который транзитивно зависит от `ResilientAiService`, обязан иметь гейт» — иначе класс дефекта возвращается на каждом новом эндпоинте. **Что сделано W1.4.3:** гейт стоит на `GetParallelPage` (на весь `BooksController` — нельзя: читалка отрезала бы неподтверждённым аккаунтам всю библиотеку); старый тест со списком из четырёх типов удалён, вместо него `AiEndpointGateTests` — обходит все публичные `[Http*]`-экшены всех контроллеров, выводит AI-достижимость из графа (маркер `IAiBackedService` + транзитивное замыкание по конструкторам), разбирает тела через Roslyn (async-вызовы в IL лежат не в том методе, который видит MVC) и падает на любом экшене без гейта. Проверено негативным контролем: с снятым атрибутом тест падает с сообщением `BooksController.GetParallelPage: GetParallelPage → «_aiService» в TranslateChunksAsync`. Позитивный контроль (`Detector_SeesEveryKnownAiEntryPoint`) не даёт страховке «зеленеть» вслепую, `Detector_DoesNotFlagReadPaths…` держит границу ложных срабатываний |
| **R-07** | Эндпоинты AI: отсутствие rate-limit политики | **Medium 5.9** (AV:N/AC:L/PR:L/UI:N/C:N/I:N/A:H) | `grep EnableRateLimiting` по контроллерам: политики есть только на `AuthController` (`:18`, `:58`), `BooksController.cs:49` (upload) и 5 админских. На `AssistantController` (`:38 chat`, `:80 analyze`), `AiController`, `AudioController`, `PronunciationController`, `BooksController.cs:377` — ** ни одной**. Единственный тормоз — `AiQuotaService`, который мягкий: счётчик кэшируется на 60 с (`Services/AiQuotaService.cs:22, 92-96`), проверка и запись не атомарны (`ResilientAiService.cs:85-101` → проверка; `:242-251` → запись после ответа) | **open** | 30.10.2026 | Добавить политику `ai` (например 20/мин на `Identity`) на 5 AI-эндпоинтов; вход уже капнут по размеру (`AssistantController.cs:43-51`: ≤30 сообщений, ≤4000 симв.), так что лимитер — единственный недостающий слой от параллельного всплеска |
| **R-08** | Глобальный бюджет Gemini (A6, п. «d» задания) | **Medium 4.8** — **заявленное работает, но не как «бюджет»** | Счётчик **не in-memory**: `AiQuotaService.GetGlobalTodayRequestsAsync` (`Services/AiQuotaService.cs:106-120`) считает `AiUsageLogs.Count(CreatedAt >= UtcNow.Date)` из Postgres → переживает рестарт и один и тот же для всех реплик. Ограничитель по **числу запросов** (default 2000/сутки, `:49`), а не по токенам/стоимости; неудачные вызовы в бюджет не пишутся (`Services/ResilientAiService.cs:242-251` логирует только успех), хотя ретраи уже сходили к провайдеру. In-memory остаётся только кэш на 60 с (`:20`, `:113`) — per-process, поэтому на N репликах перерасход ≈ N × 60 с × RPS. `Ai:GlobalDailyRequestLimit` **нет** ни в `appsettings.json`, ни в `render.yaml` (grep по репо даёт только `AiQuotaService.cs:49` и два теста) → живёт на молчаливом дефолте 2000 | **fixed (residual accepted)** | 02.11.2026 | Зафиксировать лимит явно в `render.yaml`. Считать бюджет и по токенам (сумма `TotalTokens` уже есть в таблице). Логировать и неудачные вызовы — таймаут тоже мог дойти до провайдера |
| **R-09** | Honeypot на регистрации | **Low 2.0** — контрмера **не работает, но и не мешает легитимным** | Бэкенд принимает `RegisterDto.Website` (`Controllers/AuthController.cs:420-421`) и отбивает заполненное (`:63-69`). Фронтенд **не отправляет это поле**: форма регистрации — `frontend/src/app/onboarding/page.tsx:241-259`, в теле `email, password, displayName, cefrLevel, studyGoal, dailyGoalMinutes, timeZoneId, notifyEnabled`; `website`/`honeypot` в `frontend/src` встречается только в `components/feedback/FeedbackWidget.tsx:36,144,283` (форма отзывов). Скрытого HTML-поля нет → браузерные автозаполнители его не триггерят вообще | **accepted** | 15.11.2026 | Либо добавить реальное скрытое поле в onboarding (`autocomplete="off"`, `tabindex="-1"`, visually-hidden), либо признать honeypot декорацией и ставить нормальную капчу. Легитимной регистрации honeypot не вредит (поле опционально) — риск только в ложном чувстве защиты |
| **R-10** | Лимит signup как защита от NAT-когорты (школа/офис/мобильный оператор) — п. «e» задания | **High 7.6** (AV:N/AC:L/PR:N/UI:N/C:N/I:N/A:H) | `RateLimitPolicies.cs:61` `PermitLimit = 5`, окно час, ключ `IpOnly`. Один NAT на 300 человек (школа) = 5 регистраций/час, остальные 295 получают 429. Хуже: при ненастроенном `Proxy__TrustedCidrs` (R-02) таким NAT оказывается **сам Render** → 5/час на весь мир. Тест `RateLimitPartitionTests.cs:122 SignupPolicy_FivePerHourFromOneIp_ThenBlocked` формализует именно это поведение, то есть дефект закреплён как ожидаемое | **fixed (W1.4.1, 663838a)** | 27.10.2026 | Разделить лимиты: «подозрительный» per-IP счётчик только на **неудачные** попытки (4xx/5xx), успешные регистрации не должны съедать бюджет. Либо `signup` = 30/час/IP + требование подтверждённого email для входа в AI (уже есть, R-06) как основной тормоз ботов. **Что сделано W1.4:** email-партиция `signup` (5/час на нормализованный адрес, ключ — сам email, а не IP) + агрегирующий per-IP кап 50/час в `GlobalLimiter` на путь `POST /api/auth/register` (школа/офис на 300 человек больше не отваливается; за прокси без `Proxy__TrustedCidrs` это по-прежнему одна корзина на всех — см. R-02 и стартовый WARNING) + суточный кап сервиса. Тест `SignupPolicy_FivePerHourFromOneIp_ThenBlocked`, который закреплял дефект как ожидаемое поведение, переписан: `Signup_DifferentEmailsFromOneNatIp_AllShareTheirOwnBudget`, `SignupIp_FiftyPerHourFromOneIp_ThenBlocked`, `Signup_SameEmailFromDifferentIps_StillFivePerHour`, `Signup_MissingEmail_FallsBackToIpScopedBucket` |
| **R-11** | Сканы секретов в CI: гейт, который не срабатывает | **Medium 6.1** (AV:N/AC:L/PR:L/UI:N/C:L/I:L/A:N) | `.github/workflows/secret-scan.yml:8-13` — триггер **только `pull_request`**. Фактический поток этого репозитория — прямые push в ветки: шесть рассматриваемых фиксов сделаны коммитами напрямую на `release/beta`, ни одного PR (`git log --all --merges` даёт **0** merge-коммитов; `origin/main` = `d749512`, вливания не было). Значит gitleaks не запускался ни разу. Плюс `actions/*` закреплены mutable-тегом (`@v4`, `@v2`), а не SHA; `backend-ci.yml` и `frontend-ci.yml` **не объявляют `permissions:`** → GITHUB_TOKEN наследует дефолт репозитория (обычно `write-all`) | **open** | 28.10.2026 | Добавить `push:` на `main`/`release/**` в `secret-scan.yml`; прописать `permissions: {contents: read}` во все три workflow; закрепить экшены по commit-SHA. Проверить, что gate реально красный (я не могу: веткозащита не читается без `gh`, см. «Не проверено») |
| **R-12** | Загруженные пользователями EPUB и обложки в публичном репозитории | **Medium 6.5** (AV:N/AC:L/PR:N/UI:N/C:L/I:N/A:N) — правовой + PII-экспозиция | `git ls-files` отдаёт 13 файлов под `EnglishLearningPlatform.API/uploads/` (11 `.epub` + 2 `.jpg`), 6.4 MB; `git ls-tree -r --name-only origin/main` по этому пути даёт **23** → они уже лежат в **публичной** ветке main с коммита `2fc2a43`. При этом `.gitignore:50` объявляет `EnglishLearningPlatform.API/uploads/` игнорируемым — правило появилось после того, как файлы попали в индекс, и на уже отслеживаемые пути не действует (мой запуск `site-audit gates`: SEC-3 fail). Дополнительно: корневая `.dockerignore` **не** исключает `uploads/`, а `EnglishLearningPlatform.API/Dockerfile:8` делает `COPY EnglishLearningPlatform.API/ ./` → эти файлы попадают и в build-контекст, и в publish-артефакт, и в релизный образ | **open** | 27.10.2026 | `git rm -r --cached EnglishLearningPlatform.API/uploads` + `filter-repo`/BFG по истории (иначе 447 публичных blob'ов останутся доступны), затем пересобрать образ. Добавить в корневую `.dockerignore` строку `EnglishLearningPlatform.API/uploads/**`. Проверить права на содержимое EPUB (Project Gutenberg — ок, любые «свои» книги — нет) |
| **R-13** | Вложенный `.dockerignore` из 5ad5875 | **Low 1.5** — заявленный эффект сегодня недостижим | Docker/BuildKit читают ровно **один** файл: `<context>/.dockerignore`. `render.yaml:5-6` задаёт `dockerContext: ./`, а `Dockerfile` живёт в `EnglishLearningPlatform.API/` → применяется корневая `.dockerignore`, а `EnglishLearningPlatform.API/.dockerignore` игнорируется. Реальную защиту даёт корневой файл (`**/appsettings.Development.json`, `**/.env*` — строки 12-20). Вложенный имеет смысл только если контекст переключат на `./EnglishLearningPlatform.API`, и тогда он действительно прикрывает `appsettings.Development*.json`/`.env*` — но и только: его строки `**/uploads/books/*.epub` в текущей сборке не применяются | **accepted** | 15.11.2026 | Зафиксировать в комментарии файла, что он in-effect при `dockerContext: ./`, и не описывать его как «вторая линия» в отчётах. Фактический фикс R-01/R-12 — в корневом файле и в удалении файлов из индекса |
| **R-14** | Фронтенд: Next.js 14.2.35 | **High 7.2** (оставшийся критикал) · **Mitigated 0.0** для 4 image-CVE | Мой запуск `npm audit --omit=dev` в `frontend`: **2 уязвимости — 1 critical (`next`) + 1 high (`postcss`)**. Критикал — это агрегированный диапазон `next 9.3.4-canary.0 - 16.3.0-preview.10`, внутрь которого попадают 25 адвизори; `images.unoptimized` снимаетExecuting только image-optimizer-подмножество (GHSA-h64f-5h5j-jqjh DoS, GHSA-2xp9 AVIF RCE, GHSA-2464 SVG RCE, GHSA-3x4c unbounded cache), но **не** rewrites smuggling (GHSA-ggv3), SSRF в rewrites (GHSA-p9j2), RSC cache poisoning (GHSA-wfc6, GHSA-vfv6), Server Actions DoS/SSRF (GHSA-m99w, GHSA-89xv, GHSA-p3m5), XSS в beforeInteractive (GHSA-gx5p). Проверено утверждение про `/_next/image`: `frontend/node_modules/next/dist/server/next-server.js:168-171` — при `imagesConfig.loader !== "default" \|\| imagesConfig.unoptimized` вызывается `await this.render404(req, res)` **до** импорта `ImageOptimizerCache`/декодирования, т.е. путь реально недостижим (не «500», а 404 до декдера) | **accepted** | 01.12.2026 | Переход на Next 15/16 — отдельная задача с прогоном фронтенда; до него записать принятие риска. Не включать `rewrites`/Server Actions, пока версия не обновлена. `next-auth` действительно пропатчен: 4.24.15 стоит (`node_modules/next-auth/package.json`) и в прод-аудите больше не фигурирует |
| **R-15** | Бэкенд: SixLabors.ImageSharp 3.1.12 | **High 7.3** (AV:N/AC:L/PR:N/UI:N/C:N/I:N/A:H, парсер чужих изображений) | Мой прогон `dotnet test` в контейнере (`dotnet/sdk:10.0`) выдал при restore: `NU1903` ×3 (`GHSA-j3p4-wp97-rph4`, `GHSA-j9gm-c75j-xc9q`, `GHSA-jjfr-hcj7-qf5w`) и `NU1902` ×2 на `SixLabors.ImageSharp 3.1.12`. Пакет подключён в `EnglishLearningPlatform.API/EnglishLearningPlatform.API.csproj:23` и декодирует **загруженные пользователями** аватары (`Services/AvatarService.cs`) и обложки из EPUB — то есть input от незнакомых бета-тестеров идёт прямо в уязвимый парсер. В `Security_Report_2026-10-22.md:142` этот пункт уже помечен как «не исправлено» | **open** | 28.10.2026 | Обновить до залатанной 3.1.x/3.2.x, прогнать `NU1903`-предупреждения как ошибки (`TreatWarningsAsErrors` для NuGetAudit в CI). До обновления — ограничить MIME/размер до декодирования и не открывать ImageSharp на ответах с непройденной сигнатурой |
| **R-16** | Чтение тела запроса до валидации модели (A5, п. «b» задания) | **Low 3.1** — принято осознанно | `Security/RateLimitPartitionKeys.cs:33-59`: читаются только `POST` (`:33`), только `Content-Type` c `application/json` (`:38`), только при `0 < Content-Length <= 64 KB` (`:44`); дальше `EnableBuffering()` + `Body.Position = 0` до и после чтения (`:51-59`). Chunked-тело (`Content-Length == null`) не буферизуется вовсе. Любое исключение → пустой email → IP-партиция (`:80-84`). Email в ключ кладётся в хеше `sha256(ip\|email)` (`:26`), PII в ключ лимитера не попадает. Тест `RateLimitPartitionTests.cs:95 Auth_BodyIsStillReadableAfterPartitioning` подтверждает rewind | **accepted** | 15.11.2026 | Без действий. Единственный пограничный случай: `Content-Length` — значение из заголовка клиента, но Kestrel его проверяет, а 64 KB — жёсткий потолок на запрос; при `MaxRequestBodySize` по умолчанию 30 MB лимит inspection не обходится |
| **R-17** | `AllowedHosts: "*"` + отсутствие HTTPS-redirect | **Low 3.4** | `appsettings.json:47` → `"AllowedHosts": "*"`; `Program.cs:241` — `// app.UseHttpsRedirection();` закомментирован. На шерованном LB (`*.onrender.com`) Host-заголовок не проверяется → поверхность для host-header/cache-poisoning-ответов (в связке с R-03: HSTS не доезжает) | **open** | 05.11.2026 | Проставить `AllowedHosts` по факту домена, включить `UseHttpsRedirection` после того, как `Proxy__TrustedCidrs` настроен (иначе — redirect-loop) |

---

## Что я проверил лично (не по чужим отчётам)

| # | Команда / приём | Результат |
|---|---|---|
| 1 | `dotnet test EnglishLearningPlatform.API.Tests` в `mcr.microsoft.com/dotnet/sdk:10.0` с `-v /src`, чистые `bin`/`obj`, env ConnectionString/Jwt | **`Passed! - Failed: 0, Passed: 135, Skipped: 0, Total: 135, Duration: 2 s`** — цифра 135 воспроизведена мной, не взята из отчёта. Плюс 5×NU1903/NU1902 по ImageSharp (→ R-15) |
| 2 | `docker run ghcr.io/gitleaks/gitleaks:v8.24.3 detect --source=/repo --redact` по всему репозиторию с историей | `89 commits scanned … no leaks found` |
| 3 | `git log --all -- <appsettings.Development.json>`, `git ls-files`, `git log --all -S"<3 конкретных живых значений>"` | `appsettings.Development.json` **ни разу не был в индексе** за всю историю; ни одно живое значение (JWT `rot-2026-10-20:…`, Gemini `AQ.…`, SOCKS5 `…@154.30.133.205`) не встречается ни в одном blob. Исторический `Jwt:Key` в `appsettings.json` — единственное значение `SET_IN_ENV_min_32_chars_secret_key` на всех коммитах (проверено перебором `git rev-list --all -- <файл>`) |
| 4 | `curl https://api.github.com/repos/DualClock/english-learning-platform` | `private:false`, `visibility:"public"`, `default_branch: main`, `pushed_at 2026-10-22T16:04:04Z`. **Фрейминг «до первого push» неверен — push уже был**; шесть фиксов ещё не запущены (`git ls-remote`: `origin/main = d749512`, локально `7c2bc4c`, `d749512` — предок HEAD) |
| 5 | Scratch-ASP.NET-приложение в `/c/Temp/rl-probe`, прогон в `dotnet/sdk:10.0`, 12 запросов к эндпоинту с `[EnableRateLimiting]` на контроллере **и** на действии | Контроллер-атрибут `auth` (PermitLimit 10) + экшн-атрибут `signup` (PermitLimit 2) → 429 на **3-м** запросе; action-only эндпоинт без атрибута → 429 на **11-м**. Вывод: экшн перебивает контроллер, значит `/api/auth/register` реально живёт под `signup` = **5/час/IP**, и политика `auth` к регистрации не применяется (→ R-02, R-10) |
| 6 | Чтение конвейера: `grep -n "app.Use"` по `Program.cs` | `UseForwardedHeaders()` на **214**, `UseRateLimiter()` на **256** → порядок, как заявлено в A5, соблюдён (п. «a» — подтверждено) |
| 7 | Чтение `TrustedProxySetup.cs:23-36` + тест `RateLimitPartitionTests.cs:150` | При пустом `Proxy__TrustedCidrs`: `KnownNetworks/KnownProxies/KnownIPNetworks` очищены, `ForwardedHeaders = None` → `X-Forwarded-For` с произвольного клиента **сегодня не подставляется** (п. «a» — подтверждено, подделать нельзя). Опасность появляется только вместе с включением конфигa, если origin доступен мимо прокси |
| 8 | `frontend/node_modules/next/dist/server/next-server.js:145-175` | Подтверждён 404 на `/_next/image` при `unoptimized` **до** загрузки `image-optimizer` (→ R-14) |
| 9 | `npm audit --omit=dev` в `frontend` | **1 critical + 1 high** (было 8 всего, `npm audit` = 8: 3 moderate / 4 high / 1 critical). next-auth 4.24.15 установлен и из прод-аудита исчез |
| 10 | Навык `site-audit:site-audit`, белый ящик, 6 сценариев + `ledger verify` | `gates` → SEC-3 fail (ignore-правило vs реально отслеживаемый путь `EnglishLearningPlatform.API/uploads/`, → R-12); `pipeline-trust` → PIPE-6 fail (локальный HEAD ≠ удалённый, 7c2bc4c vs d749512); `ci-hygiene` → CI-1 fail: **9** дыр укрепления в 3 workflow (→ R-11); 38 из 48 пунктов — `not-run` (движок заточен под статические сайты: BLD/CTX/INJ/LIVE/HDR требуют `--dist` и `--url`) |
| 11 | Рефлексивная проверка полноты A6: `grep -rn RequireConfirmedEmail`, `grep -rn "AiService \|ResilientAiService"`, трассировка `AiService.CallGeminiAsync → _resilient.SendAsync` | Все Gemini-вызовы сходятся в один choke point (`Services/AiService.cs:451`, `AssistantService.cs`, `SpeechService.cs`) → глобальный бюджет действительно работает для **всех** путей, включая `userId == null`. Но гейт по email стоит только на 4 из 5 контроллеров, которые доходят до Gemini (→ R-06) |

## Что я не смог проверить и почему (не «вероятно, всё хорошо»)

- **`coderabbit:code-review` не выполнен.** Сам скилл в среде есть, CLI `coderabbit` — **отсутствует** (`command not found`), авторизации нет. Ставить бинарь из интернета и отправлять диффы на внешний API без вашего явного разрешения я не стал. Диффы `3b8cb29..HEAD` я разобрал вручную по строкам (все шесть коммитов прочитаны целиком) и по чек-листу OWASP A01/A04/A05/A07/A09 — этот реестр и есть результат.
- **Живые замеры на деплое (HDR-1..4, LIVE-1..3, BLD-*): not-run.** Продукт ещё не задеплоен (задача #7 «нужен URL»), `--url` дать некому, `--dist` для Next SSR не существует. Поэтому строки R-03 и R-02 опираются на **чтение кода + конфиг**, а не на факт из сети: я утверждаю, что при `render.yaml` без `Proxy__TrustedCidrs` middleware `ForwardedHeaders` будет `None`, и это выводимо из `TrustedProxySetup.cs:29-36` и `Program.cs:153`; я **не** утверждаю, что измерил это на `lexicon-api.onrender.com`.
- **Веткозащита GitHub (CI-4): not-run.** `gh` на машине не установлен, лезть в настройки через web я не могу. Значит неизвестно, является ли `backend-ci`/`frontend-ci` блокирующим гейтом или декорацией — и это напрямую влияет на R-11.
- **Реальный egress-IP Render как клиента:** не проверял (нет деплоя). Если Render отдаёт в origin несколько адресов LB и они не совпадут с указанной CIDR-сетью, партиции разъедутся — это надо померить на первом же живом окружении, а не предполагать.
- **`next dev`-путь image-оптимизатора:** проверен только серверный путь `next start`, который и используется на Vercel; dev-обработчик я не открывал (в `dist/server/dev/next-dev-server.js` ссылки на `_next/image` grep не нашёл — доказательством «недостижим в dev» это не считаю).
- **`NEXTAUTH_SECRET` при отсутствующей env-переменной** в `api/auth/[...nextauth]/route.ts:21`, `api/avatar/[name]/route.ts:19`, `api/word-image/[name]/route.ts:17`: поведение next-auth v4 при `secret: undefined` я не проверял эмпирически. Функционально важная ветка, но вне шести проверяемых коммитов.
- **Легитимность содержимого 11 EPUB из `uploads/`** (авторские права) — юридическая, а не техническая проверка; технический факт (23 отслеживаемых файла в публичной ветке main) зафиксирован в R-12.

## Вердикт

# **NO-GO** — приглашать незнакомых бета-тестеров нельзя.

**Одна причина (блокирующая):** в репозитории нет ни одной точки конфигурации, где выставлен `Proxy__TrustedCidrs` (`render.yaml`, `docker-compose.yml`, `appsettings*.json`, `DEPLOY.md` — grep по всему дереву даёт только `Program.cs:153`, комментарий в `TrustedProxySetup.cs:11` и три теста), и в этой конфигурации новый `signup`-лимит `5/час на IP` (`RateLimitPolicies.cs:56-66`) делит одну корзину на **всех** посетителей за TLS-терминатором, то есть на всю планету — при этом тот же отсутствующий конфиг обнуляет и HSTS из A4 (`SecurityHeadersMiddleware.cs:28`). Я подтвердил эмпирически (п. 5 таблицы выше), что action-атрибут перебивает контроллерный, так что на `/api/auth/register` действует именно 5/час, а не 10/мин. Приглашение незнакомых людей упрётся в 429 на первых пяти заявках каждого часа, и «закрытый» транспортный слой останется незакрытым.

Дополнительно по условию задачи GO невозможен, потому что не выполнено требование «каждый критический/high риск либо закрыт, либо принят с датой и записан в реестр». Счёт по реестру: **5 строк severity High и выше в статусе `open`** (R-01 7.7, R-02 7.5, R-04 7.4, R-10 7.6, R-15 7.3) и **1 High в `accepted`** (R-14 7.2, принято мной, но не владельцем — записи принятия от владельца в репозитории нет ни одной). Ещё 7 строк Medium/Low в `open` (R-03, R-05, R-06, R-07, R-11, R-12, R-17) не блокируют GO сами по себе, но R-06 входит в минимальный набор ниже. Из шести коммитов полностью подтверждены как работающие: порядок middleware в A5 (`Program.cs:214` < `:256`), очищенные Known*-списки (XFF с произвольного клиента сегодня не подставляется), rewind тела после партиции, глобальный бюджет на Postgres (переживает рестарт и общего для реплик), 404 на `/_next/image` до декодера, патч next-auth до 4.24.15. Заявлено, но не подтверждено фактом: HSTS (A4 → R-03), полнота email-gate (A6 → R-06), honeypot (→ R-09), эффект вложенного `.dockerignore` (5ad5875 → R-13), работающий gitleaks-гейт (24eff1a → R-11).

**Минимальный набор для пересмотра вердикта (до 28.10):** R-02 + R-10 (одна правка конфига и разделение лимита по успешным/неудачным попыткам), R-06 (`[RequireConfirmedEmail]` на `books/{id}/parallel` + тест через рефлексию), R-04 (агрегирующий per-IP лимитер), R-12 (`git rm --cached uploads` + filter-repo до push), R-01 (перенос живых ключей из `appsettings.Development.json` и запись принятия риска по публичному репозиторию). R-14 и R-08 могут остаться `accepted` с датами выше.

---

## Дополнение менеджера от 23.10 (вечер), HEAD `e449bb1`

**Сведение расхождения.** После вердикта выяснилось, что фиксы легли в две разошедшиеся ветки от
`663838a`: `release/beta` (7a2e3b4, d7514de, d952623) и `security-fix-2026-10-23` (4691bc5,
4a277f4, 3896727). Свёл вручную: `4a277f4` и `3896727` перенесены в `release/beta`
(cherry-pick без конфликтов → `97077d3`, `e449bb1`), `4691bc5` (гейт на `/books/{id}/parallel`)
**не переносился** — его полностью покрывает `d7514de` с рефлексивным тестом на весь граф
AI-достижимости. Ветка `security-fix-2026-10-23` с этого момента лишняя, удалять не буду,
пока не подтверждено, что в ней не осталось неперенесённого.

**Что закрыто со времени вердикта:**
- **R-09 honeypot → `fixed`.** Поле `website` рендерится в онбординге (скрыто смещением и
  clipping, `tabindex=-1`, `aria-hidden`, не `display:none` над формой), уходит в теле
  `POST /api/auth/register`, а сборка тела вынесена в `frontend/src/lib/signup-payload.ts` как
  зеркало `RegisterDto`; контракт закреплён тестами с обеих сторон (`d952623`).
- **R-06 полнота email-gate → `fixed`** (`d7514de`, подтверждено в строке реестра выше).
- **R-10 и R-02 (кроме значения CIDR) → `fixed`** (`663838a`): email-партиция 5/час, per-IP
  кап 50/час, суточный глобальный кап, WARNING при голом прокси.
- Добавлены поверх вердикта: по-юзерный троттлинг AI-вызовов в минуту до Gemini (`97077d3`) и
  партиция admin-лимита по предъявленному ключу, а не по IP (`e449bb1`) — это снимает риск, что
  все админские запросы с одного NAT делят одну корзину.

**R-12 (`uploads/` в git) — расследование завершено, вывод такой.** Отслеживается 21 файл
(11 EPUB, 2 JPG, 8 SVG). Ничто в коде и ни один сид на них не ссылается: `StorySeeder.cs:174`
генерирует `uploads/covers/story-{index}.svg` при сидировании заново, `PopularBooksService`
тянет Gutenberg по whitelist-ID, GUID-имена EPUB не встречаются ни в `Data/Seed/*.json`, ни в
`.cs`. Размеры говорят сами за себя: 474733 байта ×3, 189249 ×2, 248476 JPG ×2 и четыре файла
по 2.5 КБ — это повторные загрузки одного и того же в dev-сессиях 12–22 октября, а не контент.
Значит `git rm -r --cached EnglishLearningPlatform.API/uploads` безопасен для сборки (файлы на
диске остаются, ignore-правило `.gitignore:50` уже объявляет каталог не-исходником). Два
уточнения к формулировке аудитора: (а) история публичного репозитория эти файлы **уже**
содержит, поэтому удаление из индекса без `filter-repo` проблему экспозиции не решает, а
(б) в корневую `.dockerignore` стоит добавить `EnglishLearningPlatform.API/uploads/**`, иначе
они и дальше едут в образ.

**Пересчёт вердикта.** Блокирующих по коду больше нет: из минимального набора аудитора R-02,
R-06, R-10 закрыты фиксами, R-04 закрыт частично (per-IP кап по успешным попыткам — остаётся
желательным разделение «успешные/неудачные»), R-12 и R-01 закрыться кодом не могут.
**NO-GO остаётся, и держится он теперь на трёх вещах вне репозитория:**
1. `Proxy__TrustedCidrs` не задан ни в одной деплой-переменной (R-02 остаток, R-03) —
   без него HSTS не доезжает, а per-IP лимиты снова делят одну корзину за TLS-терминатором. Это
   строка конфигурации хостинга, мне нужен URL и схема (кто терминирует TLS).
2. Живые креды в `appsettings.Development.json` (JWT 88 симв., Gemini, SOCKS5) — вынести из
   дерева, ротировать, отозвать выпущенные токены (R-01). Пока это не сделано, публикация ссылок
   запрещена независимо от цвета тестов.
3. Публичный репозиторий (R-01/R-12): решения «приватить» или «filter-repo» нет, а push в
   публичную ветку без него раскроет и dev-контент, и этот реестр. **Ничего из
   `security/`, `docs/beta-launch/` и `Security_Report_*.md` не коммитить и не пушить в
   публичный репозиторий** — там описаны незакрытые векторы.

**Что проверено мной лично на `e449bb1`:** бэкенд-сьют в контейнере
`mcr.microsoft.com/dotnet/sdk:10.0` — `Passed! Failed: 0, Passed: 231, Skipped: 0, Total: 231`;
`npm run build` фронта — успешно (32 статические страницы, 5 предсуществующих warning'ов);
`npm run test:unit` — 34/34. Перед invite реестр нужно перепроверить на финальном коммите
деплоя, потому что `origin/main` по-прежнему `d749512` и задеплоенное ≠ проверенное.

---

## Дополнение 2 (23.10, глубокий вечер) — состояние после волны 2

HEAD `a3a7c27`. Прогон: бэкенд **285/285** в контейнере `mcr.microsoft.com/dotnet/sdk:10.0`
(54 теста поверх 231), фронт-юниты **45/45**, `npm run build` успешно, `/test` — 200 и текст
без JS, приватное — 307 с `X-Robots-Tag: noindex, nofollow`.

Четыре новые строки, которые обязаны быть в реестре, потому что их породила волна 2:

- **R-18 Миграции не применены = регистрация падает, funnel нулевой.** Три миграции лежат в
  дереве (`20261023164150_AddAcquisitionAttribution`, `20261023165136_AddFirstChapterActivationIndex`,
  `20261023190630_AddGuestAnalyticsEvents`). Без первой `INSERT` в `AspNetUsers` ссылается на
  отсутствующие колонки; без третьей гостевой эндпоинт отвечает 200 и пишет в несуществующую
  таблицу — молчание в аналитике потом выглядит как «трафик не конвертирует». Порядок —
  `EXECUTION_SEQUENCE` §A9.
- **R-19 `Analytics__GuestIpSalt` не задан.** Без неё хеш гостевого IP строится на случайно
  сгенерированный ключ процесса, и счётчик «уникальных гостей» разъезжается на каждом рестарте
  free-плана. Переменная объявлена в `render.yaml` и `DEPLOY.md`, значение выдаёт владелец.
- **R-20 Правовой минимум написан, но не опубликован.** `/privacy` и `/terms` соответствуют
  фактическому коду, однако содержат `[РЕКВИЗИТЫ]` и непроверенный `hello@lexicon.app`;
  `DELETE /api/account` работает и покрыт тестом обхода всей схемы, но отозвать 7-дневный JWT
  после удаления нечем (нет revocation — корень тот же, что R-14).
- **R-21 Гостевые метрики — это проходы, а не люди.** Канал гостя, место отвала внутри теста и
  склейка «гость → регистрация» не измеряются по построению: свободный текст и cookie на
  анонимном write-пути запрещены сознательно. Выводы «Дзен даёт плохую конверсию» по гостевым
  числам делать нельзя, только по регистрациям.
- **R-22 Требование подтверждённой почты выключено по решению владельца (24.10, `5905ff2`).**
  `Auth:RequireConfirmedEmail=false`, потому что почтовый транспорт из этого региона и с этого
  VPS недоступен (SMTP-порты режет хостер — таймауты на Яндексе, Gmail и релее Timeweb при
  живых 443), и иначе каждый новый аккаунт получал `403` на клик по слову. Атрибуты на
  AI-эндпоинтах сохранены, детектор `AiEndpointGateTests` продолжает требовать гейт у каждого
  AI-достижимого экшена, флаг возвращается одной строкой. Оставшаяся дыра: одноразовый ящик
  больше не стоит ничего, так что бюджет Gemini защищают только количественные лимиты —
  300 запросов в сутки на пользователя, 2000 на весь сервис, 30 в минуту, кап 500 регистраций
  в сутки, плюс honeypot и лимит на тело запроса. Пересмотр: при появлении рабочего транспорта
  (свой домен + SMTP-релей, разблокированные порты) — включить обратно и снять эту строку.
  Вторичный эффект без почты: восстановление пароля и напоминания не доставляются, забывший
  пароль разблокируется вручную.

Вердикт по коду закрыт, сайт выкачен (`https://5.129.192.216.sslip.io/`, 24.10), и
`Proxy__TrustedCidrs=127.0.0.1/32` выставлен и проверен. Открытыми остаются два владельческих
действия: перенос и ротация живых ключей (плюс плейсхолдер `NEXTAUTH_SECRET` на сервере) и
решение по публичному репозиторию (`git rm -r --cached uploads` + `filter-repo` или
приватизация) — до них нет push, а значит нет и зафиксированного SHA выкаченной сборки и
первого зелёного CI на раннере.

---

## Дополнение 3 (24.10) — CI и публичная витрина

- **R-11 CI → `partially fixed` (4d5fda2).** Frontend CI запускал `npm test --if-present`,
  которого в `package.json` нет: юнит-тесты фронта не выполнялись никогда. Backend CI собирал
  только API и затем дёргал `dotnet test --no-build` по несуществующей тестовой сборке, а при
  отсутствии проекта печатал «skipping tests» вместо падения. Починено: `npm ci`, реальный
  `npm run test:unit`, `dotnet test` без `--no-build`, триггеры на `release/**`,
  `permissions: contents: read`, отменяемые concurrency-группы, аудит зависимостей
  (non-blocking, пока живёт принятый риск по Next 14 и ImageSharp), gitleaks уже был на PR.
  Проверено только парсингом YAML (js-yaml, 3 файла) — **на реальном GitHub-раннере не
  запускалось**, это открытая проверка: первый прогон после push обязан подтвердить, что шаги
  зелёные. Проверку «модель разошлась с миграциями» не добавлял: `has-model-changes` удалён из
  EF Core 7+, а `migrations list` требует живой базы; применение миграций остаётся ручным
  шагом номер 1 в `EXECUTION_SEQUENCE §A9`.
- **Публичная витрина (`718fffd`…`70bda61`).** Анонимный `GET /api/catalog/books[/{slug}]`
  отдаёт только книги с `UploadedByUserId == null` (тест `Catalog_ContainsNoBookWithAnOwner`),
  прямой slug приватной книги → 404, в DTO нет `FilePath` и владельца, превью ≤150 слов и
  только public domain. Попутно закрыта реальная утечка приватности: `/books` не был в
  matcher'е middleware и отдавал краулеру 200 со спиннером — теперь 307 + `X-Robots-Tag`
  (`70bda61`). Прогон: бэкенд **322/322**, фронт-юниты **73/73**, `next build` успешно с
  деградацией на сид-зеркало при недоступном API.
