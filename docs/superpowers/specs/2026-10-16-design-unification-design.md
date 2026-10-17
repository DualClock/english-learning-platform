# Унификация дизайна EnglishLearningPlatform

Date: 2026-10-16
Status: approved by user (palette option: own palette by DESIGN.md principles)

## Intent

Привести все ~18 страниц платформы к единому продукту высокого уровня. DESIGN.md (Notion-подобная система) используется как источник **принципов**: структура токенов, иерархия поверхностей, типографика, отступы, стили кнопок/карточек/инпутов. Бренд (пурпур Notion) НЕ копируется — своя палитра под edtech.

## Palette (my call — edtech, спокойная и мотивирующая)

| Token | Value | Role |
|---|---|---|
| `--color-primary` | `#0E7C7B` | signature primary CTA (спокойный teal) |
| `--color-primary-pressed` | `#0A6362` | pressed |
| `--color-primary-deep` | `#084F4E` | emphasis |
| `--color-navy` | `#0B2545` | dark hero bands / sidebar base |
| `--color-navy-deep` | `#081A33` | deeper navy |
| `--color-link` | `#0B5FA5` | inline links (distinct from primary) |
| `--color-canvas` | `#FFFFFF` | page/card surface |
| `--color-surface` | `#F6F7F9` | section backgrounds |
| `--color-surface-soft` | `#FAFAFB` | quieter sections |
| `--color-hairline` | `#E5E7EB` | 1px borders |
| `--color-hairline-strong` | `#C9CDD4` | input borders |
| `--color-ink` | `#1A1D23` | headings/body |
| `--color-charcoal` | `#373B44` | body emphasis |
| `--color-slate` | `#5D6470` | secondary text |
| `--color-steel` | `#7A8089` | tertiary |
| `--color-muted` | `#AEB3BB` | disabled/placeholder |
| tints | peach `#FFE8D4`, rose `#FDE0EC`, mint `#D9F3E1`, lavender `#E6E0F5`, sky `#DCECFA`, yellow `#FEF7D6`, yellow-bold `#F9E79F` | pastel feature cards |
| semantic | success `#1A9C3C`, warning `#B45309`, error `#D92D20` | |

## Typography

Manrope — headings (600, tight tracking на display), Inter — body. Шкала из DESIGN.md: hero-display 80 → button-md 14, responsive-сжатие (80/56/48/36). Body 16/1.55.

## Shape & spacing

Кнопки/инпуты `rounded-md` (8px), карточки `rounded-lg` (12px), pill-tab/бейджи full. Отступы по шкале 4–120px, контейнер max-width 1280px, страницы app — max-w-5xl/6xl.

## Components (edtech-варианты)

- button-primary (teal, 8px, 10px 18px), button-secondary (outline hairline-strong), button-ghost, button-on-dark; disabled — hairline bg
- card-base / card-feature + pastel tints
- text-input: 44px, hairline-strong border, focus 2px primary
- pill-tab (active = ink/navy bg), badge full-rounded, badge-tag (tint bg + deep text)
- progress bars: primary fill на surface track
- focus-visible: 2px outline primary offset 2 (accessibility)

## Anti-goals

- Не копировать пурпур `#5645d4` и navy `#0a1530` Notion
- Не менять контент обучения, тексты уроков/слов, API-контракты, роутинг, auth
- Не добавлять UI-библиотеки
- Не ломать fetch-логику страниц

## Constraints

- Только визуал/UX: классы, стили, разметка-обёртки. Логика, состояния, API-вызовы — без изменений.
- Адаптивность 375/768/1440. Контраст AA. Labels у форм, alt, touch targets ≥40px.

## Implementation approach

1. Токены: переписать `globals.css` (CSS-переменные + `@layer components` классы) и `tailwind.config.ts` (цвета/радиусы/тени из токенов).
2. Общие компоненты: `src/components/ui/` — Button, Card, Input, Badge, PillTabs, PageHeader, ProgressBar (тонкие обёртки над классами, без логики).
3. Страницы по одной, в порядке: лендинг `/` → reader/lesson/практика (`/reader/[id]`, `/lesson`, `/review`, `/quiz`, `/dictionary/**/practice`) → кабинет (`/dashboard`, `/books`, `/dictionary*`) → auth (`/login`, `/register`, `/forgot-password`, `/onboarding`) → остальное (`/grammar*`, `/translator`, `/settings`). `Sidebar`/`AppLayout` — вместе с первой защищённой страницей.
4. Проверка: `npm run lint`, `npm run build`, скриншоты dev-сервера на 3 брейкпоинтах.

## Verification

`npm run lint` и `npm run build` зелёные; ручной просмотр скриншотов ключевых страниц на 375/768/1440.
