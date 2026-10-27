# EnglishLearningPlatform — заметки проекта

## Стек и запуск
- Backend: .NET 10, ASP.NET Core, EF Core + PostgreSQL (docker `english_platform_db`, порт 5433),
  `dotnet ef database update` применять вручную — `Migrate()` в `Program.cs` нет.
- Frontend: Next.js 14 App Router, Tailwind, next-auth.
- API в dev: `http://localhost:5226` (`launchSettings` профиль `http`), фронт: `http://localhost:3000`.

## Особенности окружения (Windows + песочница)
- `dotnet test` / `dotnet run` падают на `hostfxr.dll` (0x80070005). Тесты гонять через
  `dotnet EnglishLearningPlatform.TestRunner/bin/Debug/net10.0/EnglishLearningPlatform.TestRunner.dll`
  (фильтр `--filter <ИмяТеста>`), API — через `dotnet bin/Debug/net10.0/EnglishLearningPlatform.API.dll`.
- `next build`/`next dev` падают на safe-delete, если кастомный distDir не пуст.
  Чистить каталог через PowerShell/`cmd /c rmdir`, не через Node.
- `HTTP_PROXY` в окружении ломает WebKit: запросы к localhost уходят на прокси.
  В `playwright.config.ts` proxy-переменные удаляются, baseURL — `localhost`.

## Дизайн-система
- `src/components/ui` — свои компоненты, НЕ shadcn: нет `components.json`, `cn` появился
  только как `src/lib/utils.ts` (фильтр + join, без tailwind-merge).
- Токены: `--color-*` в `globals.css` + `tailwind.config.ts` (`bg-surface`, `border-hairline`,
  `text-ink`, `text-slate`, `bg-primary`). Классы вида `bg-card` / `border-border` / `animate-in`
  из 21st.dev-сниппетов не работают — их надо переводить на токены проекта.
- Витрина новых компонентов — dev-only маршрут `/ui-lab/*` (`app/ui-lab/layout.tsx`,
  в продакшене 404). Там же `activity-heatmap` и `ai-chat-input`.
- `ActivityHeatmap` в продукте: блок «Активность за год» на `/progress`, данные —
  `GET api/progress/activity?days=365` (минуты чтения из `DailyActivities`).
- `PromptInput` в продукте: композер чата с Alex на `/translator`. Свой микрофон у него
  отключён (`showVoice={false}`) — распознавание идёт через `/api/pronunciation/transcribe`.
- `motion@14` не реэкспортирует тип `Variants` из `motion/react` — брать
  `ComponentProps<typeof motion.div>["variants"]`.

## Деплой (VPS, не Render/Vercel)
- Сервер: `root@5.129.192.216` (ключ `~/.ssh/lexicon_deploy`), сайт `https://5.129.192.216.sslip.io`,
  API `https://api.5.129.192.216.sslip.io`. nginx проксирует на 127.0.0.1:3000 и :5226.
- systemd: `lexicon-api.service` (`/opt/lexicon/api`, self-contained .NET, порт 5226) и
  `lexicon-frontend.service` (`/opt/lexicon/frontend`, `next start -p 3000`).
  Переопределения env — в `/etc/systemd/system/lexicon-api.service.d/*.conf`.
- На сервере нет .NET SDK и нет rsync. Схема выкладки: `tar -czf - | ssh ... 'tar -xzf - -C ...'`.
  API: `dotnet publish -c Release -r linux-x64 --self-contained true` → `/opt/lexicon/api-new`
  → `chmod 755 EnglishLearningPlatform.API` (tar с Windows теряет бит) → stop/swap/start.
  Фронт: залить `src` + конфиги → `NEXT_DIST_DIR=.next-new npm run build` на сервере → swap `.next` → restart.
  Бэкапы — `/opt/lexicon/backups/YYYY-MM-DD-*`.
- `NEXTAUTH_SECRET` в юните — публичный плейсхолдер из DEPLOY.md (`your-super-secret-…`).
  Ротировать = разлогинить всех; не сделано, ждёт решения владельца.

## CI
- `.github/workflows/frontend-ci.yml` — Node 22 (на 20 юнит-тесты падали: они импортируют `.ts`).
- CI прогоняет unit + lint + `next build`; красный билд = ошибка типов, как было с `trustHost`.

## Reader 3.0
- Текст книги живёт в снимке (`BookContentSnapshots`, gzip JSON), не в HTML.
  Парсер — `Services/Reader/BookSnapshotParser.cs`, версия в `ParserVersion`.
- Постраничность — CSS multi-column + сдвиг `translate3d`; якорь = `sentenceId` + `charOffset`.
  Не менять на серверную нарезку по словам.
- `GET` читалки никогда не пишет прогресс; позиция — только `PUT /position`.
- Озвучка главы — Azure Speech (`en-US-AriaNeural`), бюджет в `SpeechUsages`;
  браузерный голос — только fallback в `useListening`.
- Старые эндпоинты читалки удалены; `word-tooltip` заменён на `/api/reader/books/{id}/words/{word}`.
- E2E: `npm run test:e2e:lab` (Chromium/WebKit/iPhone). Полный смоук — `npm run test:e2e`
  с `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_BOOK_ID`.

## Конвенции
- Комментарии в коде — по-русски, объясняют «почему», а не «что».
- Тесты — xUnit, имена фактов часто по-русски (так исторически в проекте).
- Публичный репозиторий: `security/` и `docs/beta-launch/` не коммитить.

## Auth / next-auth (self-hosted VPS)
- Самостоятельный деплой на VPS за reverse-proxy (nginx/Caddy) требует **трёх вещей**:
  1. Стабильный `NEXTAUTH_SECRET` (генерировать один раз, не менять при рестарте).
  2. `NEXTAUTH_URL` = публичный HTTPS-адрес (`https://5.129.192.216.sslip.io`).
  3. `trustHost: true` в `NextAuth({ ... })` — иначе next-auth не доверяет proxy.
- Без (1) JWT не может быть декодирован после рестарта процесса → сессия «испаряется».
- `useSecureCookies` в `route.ts` берётся из `NEXTAUTH_URL.startsWith('https://')`;
  без `NEXTAUTH_URL=https://...` cookie не получает `__Secure-` префикс и `Secure`.
- Middleware (`middleware.ts`) проверяет только наличие куки (не валидность JWT).
  `NEXTAUTH_SECRET` используется `getToken` в API-роутах (`avatar`, `word-image`).
