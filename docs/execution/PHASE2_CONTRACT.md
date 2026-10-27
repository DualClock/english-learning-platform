# Фаза 2 — Контракт и владение файлами

Продолжение `EXECUTION_CONTRACT.md` (те же 8 правил действуют без изменений).
Читать целиком до первой правки. Пять субагентов работают в ОДНОМ дереве.

## 0. Стенд, который уже поднят

| Что | Где |
|---|---|
| Postgres (Docker) | `127.0.0.1:5433`, БД `lexicon_gogate`, appuser/apppass123 |
| API | `http://127.0.0.1:5226` (фоновый процесс) |
| Next dev | `http://localhost:3100` (фоновый процесс) |

**Стенд общий.** Не останавливайте эти процессы, не пересоздавайте БД, не
запускайте `docker compose down`. Если нужна чистая БД — сначала спросите
Оркестратора. `dotnet build` падает, пока работает API (`exe` занят) —
это норма, тесты гоняются через `TestRunner`.

## 1. Проверенное состояние перед Фазой 2

| Что | Факт |
|---|---|
| Миграции | 29/29 применены, `BookBookmarks.Page` nullable |
| Гостевой каталог | 8 книг, работает |
| Тесты | 178 фронт / 486 бэк, зелёные |
| E2E | `frontend/e2e/go-gate-flow.spec.ts` — 4 passed |
| Пак озвучки | **30 файлов** из 4500 (пилот) |
| `MaxTextLength` (TTS слов) | **300** символов — в `SpeechService.cs:18` и `AudioController.cs:15` |
| Azure `MaxCharsPerRequest` | 2000; `DefaultMonthlyCharLimit` = **400 000** (≈16,7 мин аудио/сутки на весь сервис) |
| Примеры к словам | `wordlists.json` — 4500 слов, **0 примеров**. `categories.json` — 520 слов, **есть** `example` |
| SRS-интервалы наружу | API отдаёт `interval`/`nextReviewDate`/`easeFactor` (`ReviewController.cs:102-107`), **фронт не использует ни одного** |

## 2. Решения (реализовывать, не обсуждать)

### R7. Лимит 300 символов снимается обоснованно, а не «на глаз»
Сейчас `MaxTextLength = 300` в двух местах: контроллер режет запрос, сервис —
текст. Предложение книги ≈ 100 символов, абзац ≈ 400. Нужно:
- `AudioController` — лимит **1200** символов (один абзац с запасом);
- `SpeechService` — тот же лимит как второй слой (не 300);
- Geminи GTX-endpoint держит ~200 символов на запрос (недокументированный
  `translate_tts`) — **если текст длиннее, сервис обязан разбить его на части
  по границам предложений и склеить MP3**, а не обрезать. Обрезка = потеря
  текста, и это сегодняшнее поведение.
- Тест: текст из 3 предложений озвучивается целиком (все три фрагмента
  переданы провайдеру), а не обрезается до 300.

### R8. Предгенерация озвучки по главам
Главы уже имеют манифест с `segments[].sentenceId` (см. `useListening.ts`,
`AzureSpeechService`). Нужно: фоновый прогрев озвучки главы по предложениям в
файловый кэш (`uploads/tts-azure`, `CacheName` детерминирован) так, чтобы
первое прослушивание не тратило квоту, а второе отдавалось с диска.
Ограничения: не более N символов за один прогрев, уважать
`MonthlyCharLimit`, не блокировать запрос пользователя.

### R9. Пак озвучки 4500 слов
`tools/tts-pack/generate.py` уже исправлен и умеет `--dry-run/--limit`,
докачку и валидацию; замерено **7.7 слов/с, 12.8 КБ/файл, $0** (Edge-TTS).
Нужно: прогнать полный пак (4470 осталось, ~14 мин), проверить, что
`SpeechService.FindPackFile` находит файл для **каждого** из 4500 слов, и
зафиксировать тестом «пак вместо квоты»: при наличии файла HTTP-вызов
провайдера = 0.

### R10. SRS-интервалы в интерфейсе
API уже отдаёт всё нужное. Нужно показать на `/progress` и `/review`:
- распределение слов по интервалам: **learning** (<1 дня), **1–7**, **8–30**, **>30**, **leech**;
- «N слов знаю надёжно» = интервал > 21 дня (объяснить формулировку в UI);
- «сегодня к повторению — M»;
- ближайший прогноз: сколько слов вернётся завтра.
Требуется **новый эндпоинт** `GET /api/progress/srs-breakdown` (агрегат по
`UserWords.IntervalDays`/`Lapses`/`NextReviewDate`) + чистые функции бакетов
на фронте с тестами.

### R11. Примеры к словам A1/A2
`wordlists.json` — 4500 слов без примеров. Нужно: добавить `example` и
`exampleRu` хотя бы для A1+A2 (~1500 слов) как **отдельный сид-файл**
`Data/Seed/word-examples.json` (не переписывать `wordlists.json` целиком) +
идемпотентный сидер, подтягивающий пример в `WordLevels` (поле нужно добавить
миграцией) и отдающий его в словаре и в карточке слова.
**Внимание:** примеры должны быть реальными английскими предложениями с
русским переводом. Генерировать их шаблонной подстановкой («I like X») —
запрещено: это обесценивает продукт. Если на 1500 слов качественных
примеров нет — сделайте меньше, но честно, и напишите сколько.

## 3. Владение файлами

### AudioCore (бывший @Coder) — лимит, паки, кэш
```
EnglishLearningPlatform.API/Controllers/AudioController.cs
EnglishLearningPlatform.API/Services/SpeechService.cs
EnglishLearningPlatform.API/Services/Reader/AzureSpeechService.cs
EnglishLearningPlatform.API/Services/Reader/ChapterSpeechPrefetcher.cs   (новый)
EnglishLearningPlatform.API/appsettings.json                              (только Azure:Speech)
EnglishLearningPlatform.API.Tests/SpeechSplitTests.cs                     (новый)
EnglishLearningPlatform.API.Tests/SpeechPackTests.cs                      (правка, владелец Media — согласовать)
```

### SrsProgress (бывший @ProductUX) — интервалы в UI
```
EnglishLearningPlatform.API/Controllers/ProgressController.cs
EnglishLearningPlatform.API/Models/DTOs/SrsBreakdownDtos.cs              (новый)
EnglishLearningPlatform.API/Services/SrsBreakdownService.cs               (новый)
EnglishLearningPlatform.API.Tests/SrsBreakdownTests.cs                    (новый)
frontend/src/lib/srs-buckets.ts + srs-buckets.test.mjs                    (новый)
frontend/src/app/progress/page.tsx                                        (только блок SRS)
frontend/src/components/progress/SrsBreakdownCard.tsx                     (новый)
frontend/src/app/review/page.tsx                                          (только строка «почему сегодня»)
```

### WordExamples (бывший @ProductUX-2) — примеры к словам
```
EnglishLearningPlatform.API/Data/Seed/word-examples.json                   (новый)
EnglishLearningPlatform.API/Services/WordExampleSeeder.cs                  (новый)
EnglishLearningPlatform.API/Migrations/*_AddWordExample.cs                 (новая)
EnglishLearningPlatform.API/Models/WordLevel.cs                            (два поля)
EnglishLearningPlatform.API/Models/DTOs/WordDtos.cs                        (поле example)
EnglishLearningPlatform.API/Controllers/DictionaryControllerClass.cs       (отдать example)
EnglishLearningPlatform.API.Tests/WordExampleSeederTests.cs                 (новый)
frontend/src/components/dictionary/WordFlashcard.tsx                       (показать пример)
```

### ListeningUI (бывший @MediaMaker) — /listening
```
frontend/src/app/listening/page.tsx
frontend/src/app/listening/ListeningPlayer.tsx
frontend/src/lib/listening.ts + listening.test.mjs
```
Правки в `useTts.ts` — **нет**: этот файл у AudioCore. Нужна правка — `NEEDS:`.

### VoicePack (бывший @MediaMaker-2) — генерация пака
```
tools/tts-pack/**                    (только скрипты, не .py-запуск на сервере)
EnglishLearningPlatform.API.Tests/SpeechPackCoverageTests.cs   (новый)
docs/execution/TTS_PACK.md           (новый: как прогнать, сколько времени)
```

## 4. Обязательные проверки перед отчётом
```
npm --prefix frontend run test:unit          # зелёный целиком
cd frontend && npx tsc --noEmit -p tsconfig.json
cd frontend && npx next lint                 # 0 новых Error
dotnet build EnglishLearningPlatform.slnx    # если API запущен — остановите его
                                             # ИЛИ используйте TestRunner без сборки
dotnet run --project EnglishLearningPlatform.TestRunner --no-build
```
E2E (только если правили гостевой путь или онбординг):
`cd frontend && npx playwright test --config=playwright.go-gate.config.ts --project=chromium`
