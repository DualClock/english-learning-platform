# English Learning Platform

Платформа для изучения английского языка по книгам и фильмам.

## Статус CI

![Backend CI](https://github.com/ТВОЙ_ЛОГИН/english-learning-platform/workflows/Backend%20CI/badge.svg)
![Frontend CI](https://github.com/ТВОЙ_ЛОГИН/english-learning-platform/workflows/Frontend%20CI/badge.svg)

## Технологии

- **Backend:** ASP.NET Core 8, EF Core, PostgreSQL, JWT
- **Frontend:** Next.js 14, TypeScript, Tailwind, NextAuth
- **CI/CD:** GitHub Actions

## Запуск локально

### Backend
```bash
cd EnglishLearningPlatform.API
dotnet run
## Категории слов

Функция «Изучение слов по категориям»: тематические подборки слов (эмоции, еда, путешествия, работа, здоровье, природа) с прогрессом и тремя режимами изучения на фронтенде (флэшкарты, «угадай перевод», «выбери вариант»).

Что добавлено:

- Таблицы `Categories`, `CategoryWords`, `UserCategoryWordProgresses` (EF Core, PostgreSQL).
- `CategoriesController`:
  - `GET /api/categories` — категории с прогрессом пользователя (выучено / в процессе / не начато);
  - `GET /api/categories/{slug}/words` — слова категории со статусом и флагом `inDictionary`;
  - `POST /api/categories/words/{id}/progress` — обновление статуса слова (`learning` / `learned`);
  - `POST /api/admin/seed-categories` — сидирование (аналогично `seed-wordlists`, заголовок `X-Seed-Key` вне Development).
- Сиды: `EnglishLearningPlatform.API/Data/Seed/categories.json` + `CategorySeeder` (идемпотентный, по `Slug`).
- Интеграция с личным словарём: кнопка «В мой словарь» вызывает существующий `POST /api/dictionary` с `source: "category"` (добавлен в `AllowedSources`).
- Фронтенд: `/categories` (сетка карточек с прогресс-барами) и `/categories/[slug]` (список слов + режимы изучения), ссылка «Категории» в сайдбаре.

Миграция и сиды:

```bash
cd EnglishLearningPlatform.API
dotnet ef database update            # применить миграцию AddCategories
# затем, при запущенном API (Development):
curl -X POST http://localhost:5226/api/admin/seed-categories \
  -H "Authorization: Bearer <token>"
```

Принятые допущения:

- Прогресс: 2 правильных ответа подряд в учебной сессии → `learned`, иначе `learning`; во флэшкартах «Знаю» = правильный ответ.
- Статус слова без записи прогресса — `not_started`.
- Флаг «в личном словаре» определяется совпадением текста слова (как в WordListsController).
- Слово считается добавленным в словарь при `200`/`409` от `POST /api/dictionary`.
