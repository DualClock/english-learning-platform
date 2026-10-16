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
| `Jwt__Key` | `q9-vgVrOrN6xM41_AaeRX8m4Cm65kF2eb7YaTPJGR2NKKG0sPJcuXNdr00gjNsTH` |
| `Jwt__Issuer` | `EnglishLearningPlatform` |
| `Jwt__Audience` | `EnglishLearningPlatform.Users` |
| `Gemini__ApiKey` | ключ Gemini из appsettings (возьми локально) |
| `Gemini__ProxyUrl` | **оставь пустым** — с серверов Render Gemini доступен напрямую |
| `Gemini__Model` | `gemini-2.5-flash` |
| `Seeder__Key` | любой секрет, напр. `lexicon-seed-2026` |

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
| `NEXTAUTH_URL` | адрес сайта Vercel (например `https://english-learning-platform-xxx.vercel.app`) |
| `NEXTAUTH_SECRET` | `3DJcV4HSPmf09HxZ0TFAjSQu1nNOsAh7UVkkAcq85mY` |

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
