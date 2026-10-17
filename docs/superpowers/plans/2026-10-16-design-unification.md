# Design Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести все страницы frontend к единой дизайн-системе (токены + общие UI-классы/компоненты), сохранив весь функционал.

**Architecture:** Токены в `globals.css` (CSS-переменные) + `tailwind.config.ts` (extend colors/radii/shadows от токенов). Общие классы в `@layer components` (`.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-on-dark`, `.card`, `.card-tint-*`, `.input`, `.badge`, `.badge-tag`, `.pill-tab`, `.page-header`, `.progress-*`). Общие компоненты `src/components/ui/` — только тонкие обёртки. Страницы переписываются на токены/классы, логика (fetch, state, auth, роутинг) не трогается.

**Tech Stack:** Next.js 14 App Router, React 18, Tailwind 3.4, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-16-design-unification-design.md`

## Global Constraints

- Палитра из spec, дословно: primary `#0E7C7B`, primary-pressed `#0A6362`, primary-deep `#084F4E`, navy `#0B2545`, navy-deep `#081A33`, link `#0B5FA5`, canvas `#FFFFFF`, surface `#F6F7F9`, surface-soft `#FAFAFB`, hairline `#E5E7EB`, hairline-strong `#C9CDD4`, ink `#1A1D23`, charcoal `#373B44`, slate `#5D6470`, steel `#7A8089`, muted `#AEB3BB`; tints peach `#FFE8D4`, rose `#FDE0EC`, mint `#D9F3E1`, lavender `#E6E0F5`, sky `#DCECFA`, yellow `#FEF7D6`, yellow-bold `#F9E79F`; semantic success `#1A9C3C`, warning `#B45309`, error `#D92D20`.
- Кнопки `rounded-md` (8px, НЕ pill), карточки `rounded-lg` (12px), badge/pill `rounded-full`.
- Инпуты высотой 44px; кликабельные элементы ≥40px; контраст AA.
- `focus-visible`: 2px outline primary, offset 2.
- НЕ менять: тексты обучения, API URL/контракты, роутинг, next-auth, логику fetch/состояний. Только визуальные классы/разметка-обёртки.
- Шрифты: Manrope (headings), Inter (body) — уже подключены в `layout.tsx`, сохранить.
- Тёмной темы нет — только light.
- Не добавлять зависимостей.
- Проверка каждой задачи: `cd frontend && npm run lint` и `npm run build` зелёные.

## Review Focus

- Пастельные tint-карточки на контрасте charcoal-текста (AA на всех 7 tint).
- Focus-visible видим на всех интерактивных элементах после замены классов.
- Мобильная адаптивность 375px у страниц с таблицами/сетками (`/grammar`, `/books`, `/dictionary`).
- Sidebar на 375px (w-64 фиксированный) — не должен ломать layout.
- Состояния loading/empty/error карточек не потеряли стили после перехода на токены.

---

### Task 1: Design tokens — globals.css + tailwind.config.ts

**Files:**
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/tailwind.config.ts`

**Interfaces:**
- Produces: CSS-переменные `--color-*`, `--radius-*` в `:root`; `@layer components` классы `.btn-primary`, `.btn-primary:disabled`, `.btn-secondary`, `.btn-ghost`, `.btn-on-dark`, `.btn-secondary-on-dark`, `.btn-danger`, `.card`, `.card-interactive`, `.card-tint-peach|rose|mint|lavender|sky|yellow|yellow-bold`, `.input`, `.badge`, `.badge-primary`, `.badge-tag`, `.badge-tag-green|orange|purple`, `.pill-tab`, `.pill-tab-active`, `.page-header`, `.progress-track`, `.progress-fill`, `.focus-ring` (применяется как общий focus-visible стиль); tailwind-цвета `primary`, `navy`, `ink`, `charcoal`, `slate`, `steel`, `muted`, `canvas`, `surface`, `surfaceSoft`, `hairline`, `hairlineStrong`, `tint.*`, `semantic.*`, `link`.

- [ ] **Step 1: Переписать токены и component-слой в `globals.css`**

Заменить палитру cream/charcoal/forest/golden/sage на токены из Global Constraints. Сохранить существующие keyframes/animations (hero demo, reduced-motion) — они используются компонентами. Добавить `:focus-visible` глобальное правило (2px outline primary, offset 2). Удалить/обновить неиспользуемые переменные (`--accent-primary` и др. — заменить ссылками на новые).

- [ ] **Step 2: Обновить `tailwind.config.ts`**

`theme.extend.colors` — маппинг из CSS-переменных (`primary: 'var(--color-primary)'` и т.д. по списку Interfaces). Радиусы: `md: 8px`, `lg: 12px`, `xl: 16px` (сохранить). Тени: `soft: 0 1px 2px rgba(15,15,15,.04)`, `card: 0 4px 12px rgba(15,15,15,.08)`, `modal: 0 16px 48px -8px rgba(15,15,15,.16)`.

- [ ] **Step 3: Проверка**

Run: `cd frontend && npm run lint && npm run build`
Expected: success (страницы ещё на старых классах — сборка не должна сломаться; хардкод-цвета продолжат работать).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/globals.css frontend/tailwind.config.ts
git commit -m "design: unified design tokens (colors, radii, shadows, focus states)"
```

### Task 2: Общие UI-компоненты `src/components/ui/`

**Files:**
- Create: `frontend/src/components/ui/Button.tsx`
- Create: `frontend/src/components/ui/Card.tsx`
- Create: `frontend/src/components/ui/Input.tsx`
- Create: `frontend/src/components/ui/Badge.tsx`
- Create: `frontend/src/components/ui/PageHeader.tsx`
- Create: `frontend/src/components/ui/ProgressBar.tsx`

**Interfaces:**
- Consumes: классы из Task 1.
- Produces:
  - `Button({variant?: 'primary'|'secondary'|'ghost'|'onDark'|'secondaryOnDark'|'danger', href?, type?, disabled?, onClick?, className?, children})` — рендерит `<button>` или `next/link` если `href`.
  - `Card({tint?: 'peach'|'rose'|'mint'|'lavender'|'sky'|'yellow'|'yellow-bold', interactive?: boolean, className?, children})`.
  - `Input({label?, error?, ...native input props})` — label привязан через `htmlFor`, error-текст `id={id}-error`, `aria-invalid`.
  - `Badge({tone?: 'primary'|'green'|'orange'|'purple'|'navy', tag?: boolean, children})`.
  - `PageHeader({title, subtitle?, actions?: ReactNode})` — заголовок страницы в стиле `.page-header`.
  - `ProgressBar({value: number (0-100), className?})`.

- [ ] **Step 1: Создать 6 компонентов по спецификациям Interfaces**

Тонкие обёртки, без логики. Все — `'use client'` только если нужны handlers (Button, Input); остальные server-compatible.

- [ ] **Step 2: Проверка**

Run: `cd frontend && npm run lint && npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui
git commit -m "design: shared ui primitives (Button, Card, Input, Badge, PageHeader, ProgressBar)"
```

### Task 3: Лендинг `/` + `HeroTranslationDemo`

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/components/HeroTranslationDemo.tsx`

- [ ] **Step 1: Переделать лендинг на токены**

Hero — navy-бэнд (`bg-navy`, белый текст, `button-primary` teal + `button-secondary-on-dark`), ниже секции на canvas/surface с pastel tint-карточками (Card tint), footer по принципу `footer-region` (canvas, hairline top border, ссылки steel). Инлайн-nav: sticky, canvas, hairline bottom. Адаптив: hero заголовок `text-4xl → md:text-6xl → xl:text-7xl`, сетки `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`.

- [ ] **Step 2: Обновить `HeroTranslationDemo` на новые классы инпута/карточки, сохранить анимации и логику перевода.**

- [ ] **Step 3: Проверка**

Run: `cd frontend && npm run lint && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/page.tsx frontend/src/components/HeroTranslationDemo.tsx
git commit -m "design: landing page on unified tokens"
```

### Task 4: Читалка и практика — `/reader/[id]`, `/lesson`, `/review`, `/quiz`, `/dictionary/lists/[id]/practice`

**Files:**
- Modify: `frontend/src/app/reader/[id]/page.tsx`
- Modify: `frontend/src/app/lesson/page.tsx`
- Modify: `frontend/src/app/review/page.tsx`
- Modify: `frontend/src/app/quiz/page.tsx`
- Modify: `frontend/src/app/dictionary/lists/[id]/practice/page.tsx`

- [ ] **Step 1: Переписать визуал каждой страницы на токены/классы.**

Reader: карточка текста на canvas с hairline border, ключевые слова — badge-tag, навигация страниц — secondary кнопки. Lesson/review/quiz/practice: вопросы heading-4, варианты ответов — card-interactive с выбранным состоянием (primary border), прогресс — ProgressBar, итоги — tint-карточки (mint для успеха). Всё состояние/логика — как есть.

- [ ] **Step 2: Проверка**

Run: `cd frontend && npm run lint && npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/reader frontend/src/app/lesson frontend/src/app/review frontend/src/app/quiz frontend/src/app/dictionary
git commit -m "design: reader, lesson, review, quiz, practice on unified tokens"
```

### Task 5: Каркас защищённых страниц — `AppLayout`, `Sidebar`

**Files:**
- Modify: `frontend/src/components/AppLayout.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Sidebar — navy база (`bg-navy`), активный пункт pill-tab-active (белый bg, navy текст), неактивные `on-dark-muted`, лого/имя продукта белым, footer-секция navy-deep.**

- [ ] **Step 2: AppLayout — контент `max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8`, mobile: sidebar drawer (fixed, translate-x, бургер-кнопка 44px в шапке-оверлее), desktop: `lg:ml-64`. fullWidth проп сохранить.

- [ ] **Step 3: Проверка**

Run: `cd frontend && npm run lint && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AppLayout.tsx frontend/src/components/Sidebar.tsx
git commit -m "design: app shell — navy sidebar with mobile drawer"
```

### Task 6: Кабинет и библиотека — `/dashboard`, `/books`, `/dictionary`, `/dictionary/add`, `/dictionary/lists/[id]` + их компоненты

**Files:**
- Modify: `frontend/src/app/dashboard/page.tsx` + `frontend/src/components/dashboard/*`
- Modify: `frontend/src/app/books/page.tsx` + `frontend/src/components/library/*`
- Modify: `frontend/src/app/dictionary/page.tsx`, `frontend/src/app/dictionary/add/page.tsx`, `frontend/src/app/dictionary/lists/[id]/page.tsx` + `frontend/src/components/dictionary/*`

- [ ] **Step 1: Dashboard-компоненты на токены** — GreetingHeader (heading-2 + subtitle slate), StatsRow (card-base, числа heading-3), StreakCard (tint-yellow-bold), ContinueReading/RecommendedShelf (card-interactive + BookCover), QuickActions (btn-secondary), скелетоны на surface.

- [ ] **Step 2: Library-компоненты** — MyBookCard/StoryCard/ClassicCard = card-interactive, BookCover с hairline border, LevelChip = badge-tag-green.

- [ ] **Step 3: Dictionary-страницы** — WordListsSection card-base, поисковая строка = search-pill стиль (44px, surface bg), слова — строки с hairline-soft разделителями, озвучка-кнопки 40px touch target.

- [ ] **Step 4: Проверка**

Run: `cd frontend && npm run lint && npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/dashboard frontend/src/components/dashboard frontend/src/app/books frontend/src/components/library frontend/src/app/dictionary frontend/src/components/dictionary
git commit -m "design: dashboard, library, dictionary on unified tokens"
```

### Task 7: Авторизация — `/login`, `/register`, `/forgot-password`, `/onboarding`

**Files:**
- Modify: `frontend/src/app/login/page.tsx`, `frontend/src/app/register/page.tsx`, `frontend/src/app/forgot-password/page.tsx`, `frontend/src/app/onboarding/page.tsx`
- Modify: `frontend/src/components/onboarding/Step*.tsx`
- Modify: `frontend/src/app/auth-layout.tsx` (использовать на всех auth-страницах)

- [ ] **Step 1: Единый auth-экран** — split layout: левая панель navy с мотивирующим edtech-месседжем (без агрессии), правая — форма на canvas, max-w формы ~400px, все поля — Input компонент с label, кнопки btn-primary full-width, ссылки — link color. Mobile: панель скрывается, форма по центру.

- [ ] **Step 2: Онбординг-шаги** — прогресс шагов ProgressBar, карточки выбора (цель/время/уровень) — card-interactive с selected = primary border, кнопки навигации secondary/primary.

- [ ] **Step 3: Проверка**

Run: `cd frontend && npm run lint && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/login frontend/src/app/register frontend/src/app/forgot-password frontend/src/app/onboarding frontend/src/app/auth-layout.tsx frontend/src/components/onboarding
git commit -m "design: auth and onboarding flows on unified tokens"
```

### Task 8: Остальное — `/grammar`, `/grammar/[id]`, `/translator`, `/settings`

**Files:**
- Modify: `frontend/src/app/grammar/page.tsx`, `frontend/src/app/grammar/[id]/page.tsx`
- Modify: `frontend/src/app/translator/page.tsx` + `frontend/src/components/assistant/*`
- Modify: `frontend/src/app/settings/page.tsx`

- [ ] **Step 1: Grammar** — список юнитов card-interactive строками, прогресс ProgressBar, фильтры — pill-tab; теория на canvas-карточке, упражнения mc/fill — как quiz из Task 4.

- [ ] **Step 2: Translator/Alex** — чат: сообщения пользователя primary-deep bg белый текст, Alex — surface bubbles; AnalysisCard = card-base; welcome screen с AlexAvatar.

- [ ] **Step 3: Settings** — форма на card-base, поля Input, сохранение btn-primary, опасная зона (выход) отделена hairline, кнопка выхода btn-secondary с error-текстом.

- [ ] **Step 4: Проверка**

Run: `cd frontend && npm run lint && npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/grammar frontend/src/app/translator frontend/src/components/assistant frontend/src/app/settings
git commit -m "design: grammar, translator, settings on unified tokens"
```

### Task 9: Финальный аудит

**Files:**
- Modify: любые оставшиеся файлы с хардкод-hex

- [ ] **Step 1: `Grep` по `#[0-9a-fA-F]{6}` в `frontend/src`** — заменить остатки хардкод-цветов на токены/классы.

- [ ] **Step 2: Проверка доступности** — все `<input>` имеют label, у декоративных иконок `aria-hidden`, контраст tint-карточек против charcoal AA.

- [ ] **Step 3: Финальная сборка**

Run: `cd frontend && npm run lint && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src
git commit -m "design: final audit — remove hardcoded colors, a11y pass"
```
