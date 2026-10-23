# Деплой Lexicon — пошаговая инструкция (бесплатно)

Три бесплатных сервиса: **Neon** (база данных) → **Render** (API) → **Vercel** (сайт).
Общее время: ~30 минут. Нужен только аккаунт GitHub (у тебя уже есть).

---

## Шаг 1. База данных — Neon (5 минут)

1. Открой https://neon.tech → **Sign up with GitHub**.
2. При создании проекта: имя `lexicon`, регион выбери ближе к тестерам (Frankfurt/Amsterdam).
3. После создания открой **Dashboard → Connection string → скопируй** строку вида:
   `postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. **Пришли мне эту строку** (или вставь сам в шаг 2) — она пойдёт в переменную `ConnectionStrings__DefaultConnection` на Render.

Миграции я применю сам после того, как строка будет на месте.

---

## Шаг 0. Секреты (обязательно прочитать)

В репозитории и его истории раньше лежали рабочие ключи (Gemini, прокси, `Jwt__Key`, `NEXTAUTH_SECRET`).
Считайте их скомпрометированными:

1. Перевыпустите ключ Gemini в Google AI Studio и удалите старый.
2. Смените пароль у прокси (`ProxyUrl`).
3. Сгенерируйте новые `Jwt__Key` и `NEXTAUTH_SECRET` (см. ниже) — все выданные ранее JWT станут недействительны.
4. По возможности почистите историю git (`git filter-repo` / BFG), иначе старые значения останутся доступны.

Никогда не коммитьте `.env`, `appsettings.Production.json` и ключи в `DEPLOY.md`.

---

## Шаг 2. API — Render (10 минут)

1. Открой https://dashboard.render.com → **Sign in with GitHub**.
2. **New → Blueprint** → выбери репозиторий `DualClock/english-learning-platform` → Apply.
   (Blueprint возьмёт `render.yaml` из корня — сервис `lexicon-api` создастся сам.)
3. Если Blueprint недоступен: **New → Web Service → выбери репозиторий**:
   - Runtime: **Docker**
   - Dockerfile Path: `./EnglishLearningPlatform.API/Dockerfile`
   - Docker Context: `./`
   - Instance Type: **Free**
4. Заполни переменные окружения (Environment):

| Переменная | Значение |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `Cors__Origins` | домен Vercel из шага 3 (например `https://lexicon-xxx.vercel.app`) |
| `ConnectionStrings__DefaultConnection` | строка из Neon |
| `Jwt__Key` | сгенерируйте свой секрет ≥ 32 символов: `openssl rand -base64 48` (не коммитьте его в git) |
| `Jwt__Issuer` | `EnglishLearningPlatform` |
| `Jwt__Audience` | `EnglishLearningPlatform.Users` |
| `Gemini__ApiKey` | ключ Gemini из appsettings (возьми локально) |
| `Gemini__ProxyUrl` | **оставь пустым** — с серверов Render Gemini доступен напрямую |
| `Gemini__Model` | `gemini-2.5-flash` |
| `Seeder__Key` | ваш собственный секрет для сидирования (придумайте, в git не храните) |
| `Email__Smtp__Host` | SMTP-хост (например `smtp.resend.com`); если пусто — письма попадают в журнал вместо отправки |
| `Email__Smtp__Port` | `587` |
| `Email__Smtp__User` | SMTP-логин |
| `Email__Smtp__Password` | SMTP-пароль / API-ключ провайдера |
| `Email__From` | адрес отправителя, например `no-reply@ваш-домен` |
| `App__FrontendUrl` | адрес сайта Vercel — используется в ссылках внутри писем |
| `Proxy__TrustedCidrs` | **см. «Лимиты и доверие прокси» ниже — без этого все лимиты работают по адресу прокси** |
| `Registration__DailyGlobalLimit` | `500` (или пусто = 500) — суточный кап новых регистраций на весь сервис |
| `Ai__GlobalDailyRequestLimit` | `2000` (или пусто = 2000) — общий дневной бюджет обращений к Gemini |
| `Analytics__GuestIpSalt` | секрет ≥ 16 символов (`openssl rand -base64 24`) — соль для хеша IP в гостевой воронке `/test`. Пусто = приложение берёт случайный ключ процесса: хеш остаётся необратимым, но «уникальные гости за сутки» начинают зависеть от рестартов и реплик. |

### Лимиты и доверие прокси (читать перед первым invite)

Приложение стоит за TLS-терминатором, поэтому `RemoteIpAddress` у всех запросов —
адрес прокси, а не клиента. Пока прокси не описан в `Proxy__TrustedCidrs`,
`X-Forwarded-For` игнорируется, и **все** лимиты по IP делят одну корзину на всю
бету. Приложение при старте пишет в журнал WARNING с текстом
«лимиты партицируются по IP прокси … задайте Proxy__TrustedCidrs» — если видите
его в логах Render, конфигурация не доведена.

| Лимит | Значение | Где задаётся | Поведение при превышении |
|---|---|---|---|
| Регистрации на один email | 5 / час | код (`RateLimitPolicies.SignupEmailPermitLimit`) | `429` |
| Регистрации на один IP (после настройки прокси — на одного клиента, до — на адрес прокси) | 50 / час | код (`RateLimitPolicies.SignupIpPermitLimit`) | `429` |
| Регистраций в сутки на весь сервис | **500** | `Registration__DailyGlobalLimit` (в `appsettings.json` тоже 500; `0` = кап выключен) | WARNING в журнал на 80% и `429` на 100% |
| Обращений к Gemini в сутки на весь сервис | **2000** | `Ai__GlobalDailyRequestLimit` (в `appsettings.json` тоже 2000; `0` = бюджет выключен) | WARNING на 80% и `429` на 100% |
| Вход на одну связку IP+email | 10 / мин | код (`auth`) | `429` |
| Админ-эндпоинты на одну связку IP+email | 10 / 5 мин | код (`admin`) | `429` |
| Гостевые события /test (воронка W2.4) | 20 / мин на IP | код (`guest-analytics`) | `429`, фронтенд их молча глотает |

Что поставить в `Proxy__TrustedCidrs`: CIDR-сети или адреса реверс-прокси через
запятую, например `10.0.0.0/24, 203.0.113.5`. Для Render это сети, из которых его
балансировщик ходит в origin — их надо **померить на живом окружении** (первый
запрос + значение `RemoteIpAddress` в логах), а не брать из головы: если указать
не ту сеть, партиции разъедутся, а если не указать ничего — бета упрётся в 429 на
первых же пятидесятых заявках часа. Счётчики регистраций и Gemini живут в Postgres
(считаются по `Users` и `AiUsageLogs` за текущие UTC-сутки), поэтому переживают
рестарт бесплатного инстанса; почасовые лимиты — в памяти процесса и после
рестарта обнуляются.


> **SMTP обязателен.** Сброс пароля и подтверждение email работают только через письма:
> токен в ответе API не отдаётся ни в Development, ни в Production. Если `Email__Smtp__Host`
> пуст, письма остаются в журнале (`/api/notifications/outbox`) и пользователь их не получит.
> В Production при пустых `Email__From` / `App__FrontendUrl` / `Email__Smtp__Host`
> приложение не стартует — это защита от «молча неработающих» писем.

> **Обратная связь беты.** Форма на сайте шлёт отзыв на `Feedback__ToEmail`
> (по умолчанию `kompasmini@yandex.com`). Копия всегда сохраняется в таблице
> `EmailMessages` с `Kind = "feedback"`, поэтому отзыв не теряется даже при сбое SMTP.
> Все отзывы можно смотреть на `/admin/feedback` — страница попросит
> `Feedback__AdminKey`. Отдельный ключ обязателен: `Seeder__Key` (ключ сидов
> контента) больше не даёт доступа к личным отзывам пользователей.

5. Deploy. Через 5-10 минут API поднимется на `https://lexicon-api.onrender.com`.
   Проверка: открой `https://lexicon-api.onrender.com/health` → `{"status":"ok"}`.

⚠️ Free-инстанс **засыпает после 15 минут** без запросов; первый запрос после сна занимает ~1 минуту. Для одного тестера — норм.

---

## Шаг 3. Сайт — Vercel (10 минут)

1. Открой https://vercel.com → **Continue with GitHub**.
2. **Add New → Project** → импортируй `DualClock/english-learning-platform`.
3. **Root Directory**: `frontend`. Framework: Next.js (определится сам).
4. Environment Variables:

| Переменная | Значение |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://lexicon-api.onrender.com` (адрес API из шага 2) |
| `NEXT_PUBLIC_SITE_URL` | публичный адрес сайта (`https://....vercel.app` из шага 5). Нужен для SEO: от него строятся `metadataBase`, `og:image`/`twitter:image`, `sitemap.xml` и `robots.txt`. Если не задать — фолбэк на `NEXTAUTH_URL`, затем на `http://localhost:3000`, и превью ссылок в Telegram/VK будут битыми. Значение без завершающего слэша, секретов внутри нет |
| `NEXTAUTH_URL` | адрес сайта Vercel (например `https://english-learning-platform-xxx.vercel.app`) |
| `NEXTAUTH_SECRET` | сгенерируйте свой: `openssl rand -base64 32` (в git не хранить) |

5. Deploy. Сайт поднимется на `https://....vercel.app`.

---

## Шаг 4. Финал (я сделаю сам, когда пришлёшь строки)

1. Применю миграции и залью контент (грамматика/слова/рассказы) в Neon.
2. Обновлю `Cors__Origins` на Render доменом Vercel → redeploy.
3. Живая проверка: регистрация → первый урок → читалка → Alex.

---

## Важные ограничения бесплатного тарифа

- **API засыпает** через 15 мин простоя (первый запрос ~1 мин). Лечится бесплатным пингером (UptimeRobot каждые 10 мин) — настроим после деплоя.
- **Файлы эфемерны**: при рестарте Render загруженные пользователем EPUB пропадают (рассказы и обложки пересоздаются автоматически). Для беты — ок.
- **Neon**: 0.5 ГБ — для беты хватает с запасом.
