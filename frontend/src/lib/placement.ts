/*
 * Тест на уровень (placement) — контракт и чистая логика, общие для онбординга
 * и публичной страницы /test (W2.2a). Сами запросы — в src/app/lib/placement-api.ts.
 *
 * Бэкенд умеет всё анонимно: `ProfileController.cs` отдаёт вопросы
 * (`GET api/profile/placement`) и считает уровень
 * (`POST api/profile/placement/result`) с `[AllowAnonymous]`, ничего не сохраняя.
 * Поэтому гостю на /test не нужен ни токен, ни аккаунт, ни новый серверный код.
 *
 * Держать контракт в двух местах нельзя: состав вопросов и пороги уровня живут на
 * сервере, клиент обязан совпадать — иначе «назад» и «повтор» на одной из двух
 * страниц отстанут от другой.
 */

/** Вопрос теста. Правильного варианта в ответе нет — выбор считает сервер. */
export interface PlacementQuestion {
  id: number;
  prompt: string;
  options: string[];
}

/** Ответ на один вопрос: индекс варианта (0..3), а не его текст. */
export interface PlacementAnswer {
  id: number;
  choice: number;
}

/** Ответ `POST api/profile/placement/result`. Уровень считает сервер. */
export interface PlacementResult {
  cefrLevel: string;
  correctCount: number;
  total: number;
}

/**
 * Пути зеркалят роуты ProfileController. Мок-тест сверяет их с сервером
 * (см. placement.test.mjs): опечатка в пути — это 404 на обеих страницах сразу.
 */
export const PLACEMENT_QUESTIONS_PATH = '/api/profile/placement';
export const PLACEMENT_RESULT_PATH = '/api/profile/placement/result';

/**
 * Ответы собираются по индексам вопросов: на /test человек листает «назад» и
 * меняет выбор, поэтому история — массив `choices`, а не стек. Пропущенные (null)
 * в тело не попадают: сервер сверяет `id` и засчитывает только то, что пришло.
 */
export function buildPlacementAnswers(
  questions: PlacementQuestion[],
  choices: (number | null)[]
): PlacementAnswer[] {
  return questions
    .map((question, index) => ({ id: question.id, choice: choices[index] }))
    .filter((answer): answer is PlacementAnswer => typeof answer.choice === 'number');
}

/**
 * Код CEFR для экрана: 'a2' → 'A2'. Сервер отдаёт строчные коды, а в интерфейсе
 * и в названии уровня уровень всегда заглавный — он и есть название шкалы.
 * Строка вида 'A2 — Элементарный' сворачивается к коду, чтобы хелпер можно было
 * применять и к ответу сервера, и к выбору из списка уровней.
 */
export function placementLevelLabel(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().split(/[\s—-]+/)[0].toUpperCase();
}

/*
 * ---- Расшифровка результата для публичного теста --------------------------
 *
 * Уровень сам по себе человеку ничего не говорит: «B1» — буква в сертификате,
 * а «держитесь в разговоре и читаете оригинал с одной вкладкой для редких слов»
 * — это решение, идти ли в библиотеку. Здесь перевод с CEFR на человеческий и
 * полка, которая на этом уровне открывается.
 *
 * Книги взяты из реальных сидов бэкенда, а не выдуманы (проверяются юнит-тестом):
 *   · рассказы Lexicon — `EnglishLearningPlatform.API/Data/Seed/stories.json`
 *     (уровни a1/a2/b1);
 *   · оригинальная классика — `Services/PopularBooksService.cs` (Alice — A2,
 *     Sherlock Holmes / Frankenstein / Dracula — B1, Austen / Wilde / Brontë /
 *     Dickens — B2, Moby-Dick — C1).
 * Полка обязана совпадать с тем, что человек увидит в /books после регистрации:
 * обещание «B1 — и вот это уже читается» проверяется одним кликом.
 */

export interface ReadingPick {
  title: string;
  author: string;
  /**
   * Уровень книги из сида, а не из головы: на полке C1 лежат и книги C1, и B2,
   * которые человек с C1 уже читает свободно. Плашка показывает именно `level`.
   */
  level: string;
  /** 'lexicon' — короткий рассказ из сида, 'classic' — оригинал из Gutenberg */
  kind: 'lexicon' | 'classic';
}

export interface LevelGuide {
  code: string;
  name: string;
  /** Что уровень значит на языке человека */
  readout: string;
  /** Что читать дальше в библиотеке Lexicon */
  picks: ReadingPick[];
}

const KIND_CAPTION: Record<ReadingPick['kind'], string> = {
  lexicon: 'рассказ Lexicon: короткий, словарь по клику',
  classic: 'оригинал из библиотеки: параллельный текст и разбор слов',
};

export function readingPickCaption(pick: ReadingPick): string {
  return KIND_CAPTION[pick.kind];
}

const GUIDES: Record<string, LevelGuide> = {
  A1: {
    code: 'A1',
    name: 'Начальный',
    readout:
      'Вы узнаёте отдельные слова и самые простые фразы. Это не «нулевой» уровень, а стартовая точка: короткие истории на 100–200 слов уже читаются, а до оригинальной классики ещё два шага.',
    picks: [
      { title: 'The Lost Kitten', author: 'Lexicon Stories', level: 'A1', kind: 'lexicon' },
      { title: 'The Magic Paintbrush', author: 'Lexicon Stories', level: 'A1', kind: 'lexicon' },
    ],
  },
  A2: {
    code: 'A2',
    name: 'Элементарный',
    readout:
      'Вы справляетесь с адаптированными текстами и простыми диалогами: бытовые сцены читаются без перевода каждого слова. До оригинальной классики пока один шаг — сначала рассказы, «Алиса» как первые настоящие тридцать страниц на английском.',
    picks: [
      { title: 'The Winter Fox', author: 'Lexicon Stories', level: 'A2', kind: 'lexicon' },
      { title: 'The New Neighbour', author: 'Lexicon Stories', level: 'A2', kind: 'lexicon' },
      {
        title: "Alice's Adventures in Wonderland",
        author: 'Lewis Carroll',
        level: 'A2',
        kind: 'classic',
      },
    ],
  },
  B1: {
    code: 'B1',
    name: 'Средний',
    readout:
      'Вы понимаете основную идею текста и держитесь в разговоре на знакомую тему. Порог пройден: оригинальная классика становится читаемой — не по словарю в каждом предложении, а с одной вкладкой для редких слов.',
    picks: [
      {
        title: 'The Adventures of Sherlock Holmes',
        author: 'Arthur Conan Doyle',
        level: 'B1',
        kind: 'classic',
      },
      { title: 'Frankenstein', author: 'Mary Shelley', level: 'B1', kind: 'classic' },
      { title: 'The Key to Number Nine', author: 'Lexicon Stories', level: 'B1', kind: 'lexicon' },
    ],
  },
  B2: {
    code: 'B2',
    name: 'Выше среднего',
    readout:
      'Вы читаете оригинал почти без напряжения и понимаете сложные тексты по существу. Дальше уже не «учить английский», а длина и плотность: проза со сложным синтаксисом и точная лексика в том, что вам действительно интересно.',
    picks: [
      { title: 'Pride and Prejudice', author: 'Jane Austen', level: 'B2', kind: 'classic' },
      { title: 'The Picture of Dorian Gray', author: 'Oscar Wilde', level: 'B2', kind: 'classic' },
      { title: 'Great Expectations', author: 'Charles Dickens', level: 'B2', kind: 'classic' },
    ],
  },
  C1: {
    code: 'C1',
    name: 'Продвинутый',
    readout:
      'Вы свободно работаете со сложным текстом: ирония, длинные периоды, профессиональная лексика. Учебные пересказы вам не нужны — остаётся самое плотное: Мелвилл в оригинале, а вся викторианская полка (Бронте, Остин, Диккенс) читается свободно.',
    picks: [
      { title: 'Moby-Dick', author: 'Herman Melville', level: 'C1', kind: 'classic' },
      { title: 'Jane Eyre', author: 'Charlotte Brontë', level: 'B2', kind: 'classic' },
      { title: 'Wuthering Heights', author: 'Emily Brontë', level: 'B2', kind: 'classic' },
    ],
  },
};

/**
 * Расшифровка уровня. Пороги считает сервер (`ProfileController.SubmitPlacementResult`):
 * 0–4 → A1, 5–7 → A2, 8–10 → B1, 11–13 → B2, 14–16 → C1. C2 тестом не выдаётся,
 * поэтому ветки для него нет. Неизвестное значение экран не роняет — отдаётся
 * спокойный fallback без полки.
 */
export function getLevelGuide(level: string | null | undefined): LevelGuide {
  const code = placementLevelLabel(level);
  if (GUIDES[code]) return GUIDES[code];

  return {
    code: code || '—',
    name: 'Уровень определён',
    readout:
      'Тест показал этот уровень. Откройте в библиотеке полку рядом с ним — там текст, который читается без насилия над собой.',
    picks: [],
  };
}

