# File Ownership — параллельные правки

Пять исполнителей работают в одном дереве. Каждый владеет строго своими файлами.
Пересечение = конфликт. Изменение чужого файла запрещено (см. правило 1 контракта).

## Volume — слой доступа к API + онбординг + дашборд
```
frontend/src/app/api/auth/[...nextauth]/route.ts     (только удаление session.accessToken)
frontend/src/app/api/next/[...path]/route.ts         (владелец: Оркестратор — не менять)
frontend/src/app/lib/proxy-path.ts                   (владелец: Оркестратор — не менять)
frontend/src/app/lib/api-client.ts
frontend/src/app/lib/use-api.ts
frontend/src/app/lib/analytics.ts
frontend/src/lib/reader/api.ts
frontend/src/types/next-auth.d.ts
frontend/src/middleware.ts
frontend/src/components/AppLayout.tsx
frontend/src/components/Sidebar.tsx
frontend/src/app/onboarding/**                        (page.tsx, layout.tsx)
frontend/src/components/test/PlacementTest.tsx
frontend/src/lib/signup-payload.ts + signup-payload.test.mjs
frontend/src/lib/onboarding-*.ts (новые чистые утилиты) + тесты
frontend/src/app/dashboard/page.tsx
frontend/src/components/dashboard/StatsRow.tsx
frontend/src/components/dashboard/TodayReview.tsx
frontend/src/components/dashboard/StreakCard.tsx
frontend/src/app/books/page.tsx
frontend/src/app/categories/[slug]/page.tsx
frontend/src/app/dictionary/**
frontend/src/app/grammar/[id]/page.tsx
frontend/src/app/practice/**
frontend/src/app/quiz/page.tsx
frontend/src/app/reader/[id]/page.tsx
frontend/src/app/review/page.tsx
frontend/src/app/settings/page.tsx
frontend/src/components/dashboard/FirstLesson.tsx
frontend/src/components/dashboard/RecommendedShelf.tsx
frontend/src/components/dictionary/DictionaryWordRow.tsx
frontend/src/components/AvatarPicker.tsx
frontend/src/components/WelcomeBackModal.tsx
frontend/src/hooks/useTts.ts
```

## GuestReader — гостевой режим (только новые файлы + middleware-исключение согласуется с Volume)
```
EnglishLearningPlatform.API/Controllers/GuestReaderController.cs          (новый)
EnglishLearningPlatform.API/Services/Guest/GuestReaderCatalog.cs          (новый)
EnglishLearningPlatform.API/Services/Guest/GuestWordLookup.cs             (новый)
EnglishLearningPlatform.API/Services/Guest/GuestPreviewOptions.cs         (новый)
EnglishLearningPlatform.API.Tests/Guest/GuestReaderTests.cs               (новый)
frontend/src/app/reader/preview/[slug]/page.tsx                           (новый)
frontend/src/app/reader/preview/[slug]/GuestReaderView.tsx                (новый)
frontend/src/lib/guest-reader.ts + guest-reader.test.mjs                  (новый)
frontend/src/lib/reader/types.ts                                          (только добавление Guest* типов)
frontend/e2e/guest-reader.spec.ts                                         (новый)
```
Обязательство перед Volume: `/reader/preview/*` не должен гейтиться middleware —
согласование через Оркестратора, правку `middleware.ts` делает Volume.

## BackendOps — бэкенд: уведомления, лига, безопасность миграций
```
EnglishLearningPlatform.API/Controllers/AuthController.cs
EnglishLearningPlatform.API/appsettings.json
EnglishLearningPlatform.API/Services/LeagueService.cs
EnglishLearningPlatform.API.Tests/RegistrationNotifyTests.cs              (новый)
EnglishLearningPlatform.API.Tests/Migrations/AppliedMigrationsTests.cs     (новый)
EnglishLearningPlatform.Tests/MigrationsFixture/**                        (новый, если нужен)
deploy/                                                                    (новый каталог: скрипты)
docs/execution/GO_GATE_RUNBOOK.md                                          (новый)
```
Пересечение с GuestReader в C# — нет (`GuestReaderController` новый, `AuthController` только у BackendOps).

## Craft — секреты, CI, скрипты деплоя/бэкапа, миграции-скрипты
```
.github/workflows/backend-ci.yml
.github/workflows/frontend-ci.yml
.github/workflows/secret-scan.yml
EnglishLearningPlatform.API/Dockerfile
render.yaml                     (удалить — согласовать с Оркестратором перед delete)
DEPLOY.md                       (переписать под VPS)
package.json (корневой, если нет — не создавать)
docs/execution/SECRET_ROTATION.md (новый)
scripts/bootstrap-secrets.mjs    (новый)
```

## Media — озвучка и аудирование
```
tools/tts-pack/**                 (generate.py, README)
EnglishLearningPlatform.API/Services/SpeechService.cs      (только путь пака, без ломки API)
EnglishLearningPlatform.API.Tests/SpeechPackTests.cs       (новый)
frontend/src/app/listening/page.tsx                         (переписать)
frontend/src/app/listening/ListeningPlayer.tsx              (новый)
frontend/src/lib/listening.ts + listening.test.mjs          (новый)
```
