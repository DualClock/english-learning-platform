---
name: word-illustrations
description: Иллюстрации для карточек слов Lexicon. Использовать при генерации, нормализации, публикации и QA картинок к словам категорий (frontend/public/words), а также при изменении стиля «Lexi-card», манифеста wordIllustrations или компонента WordIllustration.
---

# Агент-иллюстратор Lexicon

Отвечает за весь цикл картинок к словам: спека → генерация → нормализация →
публикация → манифест → QA. Не трогает БД и API: картинки живут как статика
фронтенда.

## Инварианты стиля «Lexi-card» (утверждён вариант **B — без контура**)

Менять только вместе с PLAN.md и повторной генерацией всего набора — иначе
набор разъедется.

- Один объект/сцена по центру, ~70% кадра, равные поля.
- Восковая/гуашевая зернистая заливка. **Без градиентов, теней, бликов, 3D.**
- **Без контуров вообще** — силуэт держится плотностью заливки, не обводкой.
- Лицо: две точки-глаза, короткая дуга-улыбка, два овальных румянца `#F3B39B`.
- Палитра: крем `#FFF2D8`, терракота `#E08A5F`, шалфей `#9BBF8A`, роза `#F3B39B`,
  тил `#0E7C7B` (акцентом). Мягко, но с читаемым контрастом — картинка должна
  узнаваться на 56 px, поэтому «просто пастель» не годится.
- Фон: **чистый белый** (совпадает с `bg-canvas` карточки в светлой теме).
- Запрещено: текст, буквы, цифры, рамки, коллажи, фотореализм, подписи, тени под объектом.

## Шаблон промпта

```
Children's flashcard illustration of {scene}, hand-drawn kawaii style, soft wax
crayon and colored pencil texture with visible grain, single subject centered and
occupying about 70% of the frame, simple kawaii face with two small black dot eyes,
a tiny curved smile and two soft pink blush oval cheeks, no outlines at all, flat
matte crayon fill in warm cream, terracotta, sage green and soft pink, muted but
with clear contrast so the subject reads at small size, on a pure white background,
generous even margins on all sides, no text, no letters, no numbers, no shadows,
no gradients, no frames
```

`{scene}` берётся из `art-direction.json` и описывает **что нарисовать**, а не
как: «a single red apple with one leaf», «a person shrugging with open palms».

## Типы слов и как их рисовать

| Тип | Примеры | Приём |
|---|---|---|
| object | apple, ticket, scarf | один предмет, лицо на нём |
| action | to borrow, to hurry | персонаж в позе, предмет-опора |
| abstract | joy, patience, freedom | метафора/сцена: солнце в груди, котелок терпения |
| trait | honest, shy | персонаж + один читаемый жест |
| place | station, market | простая сцена из 2–3 форм, без перспективы |
| relation | neighbour, colleague | два персонажа, дистанция между ними |

Абстракции **нельзя** рисовать «предметом с лицом» — получается бессмыслица.

## Параллельная работа агентов: обязательный протокол

`output_dir` у генератора — общий на процесс и при параллельных вызовах «плывёт»:
файл может лечь в папку другого агента, а два вызова в одну секунду затирают
друг друга. Поэтому каждый агент работает так:

1. Один вызов генерации за раз. Никогда не запускать несколько генераций в одном
   сообщении — даже в своей папке.
2. Сразу после ответа взять из него `localPath` (реальный путь записи), а не
   надеяться на запрошенный `output_dir`.
3. Перенести файл в `raw/<category>/<slug>/<slug>.png` (имя = slug, иначе
   `prepare_card.py` не соберёт путь).
4. Если по `localPath` файла нет (его затёрли) или папка пуста — сгенерировать
   это слово ещё раз. Один повтор обязателен, второй — только если первый тоже
   потерялся.
5. Не запускать `build_manifest.py` (общий файл) и не трогать `frontend/`:
   публикацию и манифест собирает один ответственный в конце волны.

## Пайплайн

1. Спека: `docs/word-illustrations/art-direction.json` (по слову: `type`, `scene`).
2. Генерация: промпт = шаблон + `scene`. Одна картинка = один вызов.
3. Нормализация:
   `python tools/prepare_card.py <in.png> <out.webp>`
   (обрезка по bbox → квадрат с полями → 512×512 → WebP q88).
4. Публикация: `frontend/public/words/<category-slug>/<word-slug>.webp`.
   `word-slug` = lower-case, пробелы и апострофы → дефис, без диакритики.
5. Манифест: `python tools/build_manifest.py` →
   `frontend/src/lib/wordIllustrations.generated.ts` (Set ключей `cat/word`).
6. QA: `python tools/contact_sheet.py <category-slug>` → PNG-лист 5×4 для приёмки.

## Правила безопасности

- Не генерировать картинки пачками без подтверждения бюджета (5–10 кредитов/шт).
- Не менять `categories.json`, модели и контроллеры в рамках этой задачи.
- Не удалять и не перезаписывать существующие файлы в `public/words` без бэкапа.
- Имена файлов — только `[a-z0-9-]`, иначе ломается раздача на Linux-хостинге.
