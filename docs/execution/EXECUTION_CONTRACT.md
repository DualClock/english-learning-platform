# Execution Contract — Lexicon (Фазы 0–1)

Этот файл — единственный источник правды для субагентов, работающих с репозиторием.
Любой субагент обязан прочитать его целиком до первой правки.

## 0. Жёсткие правила

1. **Не ломать чужое.** Пять субагентов работают в ОДНОМ рабочем дереве одновременно.
   Ты правишь только файлы из своего списка владения. Если нужна правка в чужом файле —
   не делай её, а опиши в отчёте `NEEDS:` (что и зачем).
2. **TDD.** Сначала падающий тест, потом код. Тест должен падать по правильной причине —
   приложи вывод прогона до правки. Исключение: чистые правки текста/констант без логики.
3. **Проверка перед отчётом.** Каждый обязан прогнать и приложить вывод:
   - `npm --prefix frontend run test:unit` (должен быть зелёным ЦЕЛИКОМ)
   - `cd frontend && npx tsc --noEmit -p tsconfig.json` (0 ошибок)
   - `cd frontend && npx next lint` (без новых warnings)
   - `dotnet build EnglishLearningPlatform.slnx` если правил C# (0 ошибок)
   Если чужой параллельный правкой сломано — пиши `BLOCKED:` с точным путём и сообщением.
4. **Без костылей.** Никаких `// @ts-ignore`, `eslint-disable`, `as any` для обхода
   типов, `try{}catch{}` вокруг реальной ошибки, закомментированного кода.
5. **Русские комментарии** — как в остальном репозитории. Комментарий объясняет ПОЧЕМУ,
   а не ЧТО. Не комментируй очевидное.
6. **Стиль — как в файле.** Не переформатируй чужой код, не переставляй импорты без нужды.
7. **Ничего не коммить.** Ветка не переключается, `git commit`/`push`/`reset` запрещены.
8. **Не запускать сервер на прод, не трогать SSH, не деплоить.**

## 1. Карта репозитория (что где)

```
frontend/                      Next.js 14 App Router, TS, Tailwind
  src/app/                     маршруты (page.tsx = экран)
  src/app/lib/api-client.ts    fetch-обёртка: кэш, inflight, 401
  src/app/lib/use-api.ts       useApiQuery — единственный хук чтения
  src/app/api/*                route handlers (серверные прокси)
  src/middleware.ts            гейт приватных разделов по наличию куки
  src/components/**            UI
  src/lib/**                   чистые утилиты (юнит-тесты рядом, *.test.mjs)
  e2e/                         Playwright
EnglishLearningPlatform.API/   ASP.NET Core + EF Core
  Controllers/                 REST
  Services/Reader/             читалка: контент, прогресс, озвучка
  Services/SrsService.cs       SM-2
  Data/Seed/*.json             сид-контент
EnglishLearningPlatform.API.Tests/  xUnit (Linux-only прогон; на Windows testhost падает)
```

## 2. Решения, уже принятые Оркестратором (не обсуждать, реализовывать)

### R1. Токен API никогда не покидает сервер
`/api/auth/session` **не отдаёт** `accessToken`. Браузер ходит только через серверный
прокси `/api/next/[...path]`, который достаёт `accessToken` из зашифрованной httpOnly-куки
NextAuth через `getToken()` и подставляет `Authorization`.

Уже сделано Оркестратором (НЕ переделывать):
- `frontend/src/app/api/next/[...path]/route.ts` — прокси (GET/POST/PUT/PATCH/DELETE),
  стримит тело, пробрасывает статус и content-type, не кэширует, не логирует токен.
- `frontend/src/app/lib/proxy-path.ts` — `toProxyUrl(path)`, единая точка склейки.
- `frontend/src/lib/proxy-path.test.mjs` — юнит-тесты склейки.

Что должны сделать исполнители:
- `api-client.ts`: убрать `token` из сигнатур **публичного API** (`apiGet`, `apiMutate`,
  `prefetchApi`), ходить по `toProxyUrl(path)`. `cacheKey(path, token)` → `cacheKey(path)`.
  `invalidateCache` перевести с `includes` на `startsWith`.
- `use-api.ts`: убрать `useSession` и `token`; запросы идут без токена.
- Все 57 вызовов `session?.accessToken` удалить: компоненты, которым токен нужен был только
  для api-client, теряют проп. Где токен передавался в `lib/reader/api.ts` — функция
  `request()` перестаёт ставить `Authorization` (его ставит прокси), сигнатуры `getReader*`
  теряют параметр `token`.
- `[...nextauth]/route.ts`: удалить `session.accessToken = token.accessToken` (строка 162).
  В `jwt`-колбэке `token.accessToken` остаётся — он живёт в зашифрованной куке и нужен прокси.
- `accessToken` удалить из типа сессии: `frontend/src/types/next-auth.d.ts`.
- ❗ Порядок: правки в `api-client.ts`/`use-api.ts`/прокси делает **Volume** (владелец),
  остальные используют новые сигнатуры. Если меняешь чужой файл — см. правило 1.

### R1b. Свести In-memory кэш к ограниченному LRU + декларативные причины ошибок
`api-client.ts` (владелец — Volume): кэш ограничен 100 записями (вытеснение по
старейшему `at`), `ApiError` получает код (`email_confirmation_required`, `unauthorized`).

### R2. Гостевой режим чтения — новый параллельный слой, он не трогает существующие сервисы
Новые файлы (не менять существующие):
- `API/Services/Guest/GuestReaderCatalog.cs` — каталог публичных книг (книги с
  `UploadedByUserId == null`, то есть классика/истории, загруженные сидом).
- `API/Services/Guest/GuestWordLookup.cs` — перевод слова из `WordLevels` + (если есть)
  AI-перевод, но **с жёстким лимитом по IP и без записи в БД**.
- `API/Controllers/GuestReaderController.cs` — `[AllowAnonymous]`, маршруты:
  - `GET /api/guest/books` — список preview-книг (slug, title, level, chapter count);
  - `GET /api/guest/books/{slug}` — манифест: главы, только ГЛАВА 1;
  - `GET /api/guest/books/{slug}/chapters/{chapterId}` — блоки/предложения главы 1;
  - `GET /api/guest/books/{slug}/words/{word}` — перевод + уровень.
  Только чтение. **Никаких** `savePocket`, `progress`, `bookmark` для гостя.
- Фронт: `frontend/src/app/reader/preview/[slug]/page.tsx` (серверный компонент
  подтягивает данные через тот же каталог, что `/library`), `GuestReaderView.tsx`
  (клиент: рендер текста, клик по слову, лист перевода, CTA «сохранить слово» → `/onboarding`).
- `middleware.ts`: `/reader/preview` НЕ входит в matcher (проверь, что `'/reader/:path*'`
  исключает `preview` — если нет, добавь явное исключение в начало middleware).
- E2E: `frontend/e2e/guest-reader.spec.ts` — лендинг → клик по книге → клик «Читать
  без регистрации» → клик по слову → виден перевод; без токена и без куки.

### R3. Онбординг: два поля и перенос уровня
- `onboarding/page.tsx`: убрать шаг `placement` и шаг `level` из обязательного пути.
  Остаётся: `account` (email + пароль) и `goal` — выбираемый после регистрации.
  Уровень приходит ТОЛЬКО из `?level=b1` (результат `/test`) или из `POST /api/placement`
  если пользователь нажал «проверить уровень» на онбординге. Никакого теста внутри формы.
- Поле «Имя» необязательное: скрыто под «Указать имя (необязательно)», бэкенд уже умеет
  выводить имя из e-mail (`ReminderService.cs:108`).
- `NotifyEnabled` по умолчанию `true` (чекбокс предвыбран, текст «напомним в 9:00»).
- `PlacementTest.tsx`: результат ведёт на `/onboarding?level=<level>` c уровнем в query.
- После `signIn` в онбординге — `router.push('/books?first=1')`, а не `/dashboard`.

### R4. Дашборд: различать «пусто» и «сломалось»
- `useApiQuery` уже отдаёт `error`. Дашборд обязан проверять ошибку КАЖДОГО из шести запросов.
- `TodayReview` принимает `reviewCount: number | null` + `hasError: boolean`.
  При `null`/ошибке — «Не удалось загрузить повторения» + кнопка повтора, НЕ «Всё повторено».
- `StreakCard` принимает `streak | null` + `isLoading` + `hasError`; при ошибке — empty state,
  не вечный скелетон.
- `StatsRow`: при отсутствии данных показывает `—`, а не `0`.
- Удалить `WARMUP_PATHS` прогрев всех 13 эндпоинтов.
- Лига: `WeeklyLeague` не рендерится вообще, если `participantCount < 10`; вместо неё —
  личная цель недели (XP против прошлой недели).

### R5. Напоминания
`AuthController.cs:96` — `NotifyEnabled = dto.NotifyEnabled ?? true`. Онбординг ставит
чекбокс предвыбранным. Юнит-тест на бэкенде: регистрация без поля → `NotifyEnabled == true`.

### R6. Озвучка слов из пака
`SpeechService` уже проверяет пак первым (`FindPackFile`). Нужно: скрипт предгенерации
пака для 4500 слов + тест, что при наличии файла паке не происходит HTTP-вызов провайдера.

## 3. Что НЕ входит в работу
Фазы 2–3 отчёта аудита (реальное аудирование, B2-грамматика, плейсхолдер домена),
мобильное приложение, i18n, монетизация, CDN.
