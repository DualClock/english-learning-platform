/*
 * Аудирование: чистые правила плеера — без DOM, без fetch, без React.
 *
 * Зачем отдельный модуль: «Аудирование» раньше было реэкспортом квиза
 * (src/app/listening/page.tsx отдавал квиз по одному слову), то есть человек
 * выбирал перевод услышанного слова и связного текста не видел вообще.
 * Настоящее аудирование — это рассказ, подсветка предложения, которое звучит
 * сейчас, и скорость 0.75/1.0/1.25. Всё, что здесь можно проверить без браузера,
 * проверяется здесь: Node запускает .ts напрямую, тесты рядом.
 *
 * Границу предложений берём из src/lib/reader/sentences.ts — та же функция, что
 * режет главы в читалке. Второй разбиватель разошёлся бы с читалкой на
 * сокращениях и инициалах, и подсветка «прыгала» бы на «Mr. Smith».
 */

import { splitIntoSentences } from './reader/sentences';

/** Скорость воспроизведения: медленно (ученик), норма, быстро (повтор). */
export const PLAYBACK_RATES = [0.75, 1.0, 1.25] as const;

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export const DEFAULT_RATE: PlaybackRate = 1.0;

export function isPlaybackRate(value: unknown): value is PlaybackRate {
  return typeof value === 'number' && (PLAYBACK_RATES as readonly number[]).includes(value);
}

/**
 * Ближайшая допустимая скорость: localStorage и URL могут принести что угодно.
 * Проверка «уже валидно» стоит ПОСЛЕ приведения к числу: `isPlaybackRate`
 * выходит по `typeof === 'number'`, и `normalizeRate(7)` вернул бы 7.
 */
export function normalizeRate(value: unknown): PlaybackRate {
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return DEFAULT_RATE;
  if (isPlaybackRate(numeric)) return numeric;

  return PLAYBACK_RATES.reduce<PlaybackRate>(
    (best, rate) => (Math.abs(rate - numeric) < Math.abs(best - numeric) ? rate : best),
    DEFAULT_RATE,
  );
}

export type RateDirection = 1 | -1;

/** Переключение скорости по кругу: 0.75 → 1 → 1.25 → 0.75. */
export function nextRate(current: PlaybackRate, direction: RateDirection = 1): PlaybackRate {
  const index = PLAYBACK_RATES.indexOf(current);
  const from = index < 0 ? PLAYBACK_RATES.indexOf(DEFAULT_RATE) : index;
  const next = (from + direction + PLAYBACK_RATES.length) % PLAYBACK_RATES.length;

  return PLAYBACK_RATES[next];
}

/**
 * Скорость влияет только на время, а не на текст и не на границы предложений:
 * тайминги считаются от базовой длительности и делятся на коэффициент.
 */
export function applyRate(seconds: number, rate: PlaybackRate): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;

  return seconds / rate;
}

export function formatRate(rate: PlaybackRate): string {
  return rate === 1 ? '1×' : `${rate}×`;
}

// ---------------------------------------------------------------------------
// Текст и предложения
// ---------------------------------------------------------------------------

export interface ListeningSentence {
  /** Индекс в рассказе, с 0 — им же адресуется подсветка */
  index: number;
  text: string;
  /** Абзац рассказа: Enter-разрыв виден, но предложения идут сквозной нумерацией */
  paragraph: number;
}

/**
 * Рассказ -> предложения. Пустые абзацы пропускаются; пустой рассказ — пустой
 * массив, а не одно пустое предложение (иначе плеер «играл» бы ничего).
 */
export function buildSentences(paragraphs: readonly string[] | null | undefined): ListeningSentence[] {
  if (!paragraphs || paragraphs.length === 0) return [];

  const result: ListeningSentence[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    for (const text of splitIntoSentences(paragraph ?? '')) {
      result.push({ index: result.length, text, paragraph: paragraphIndex });
    }
  });

  return result;
}

/** Первое и последнее предложение абзаца — для отступов между абзацами. */
export function paragraphBounds(sentences: readonly ListeningSentence[]): Map<number, { first: number; last: number }> {
  const bounds = new Map<number, { first: number; last: number }>();

  for (const sentence of sentences) {
    const existing = bounds.get(sentence.paragraph);

    if (!existing) {
      bounds.set(sentence.paragraph, { first: sentence.index, last: sentence.index });
    } else {
      existing.last = sentence.index;
    }
  }

  return bounds;
}

/** Клип в допустимых границах; пустой текст даёт -1, потому что играть нечего. */
export function clampSentence(count: number, index: number): number {
  if (count <= 0) return -1;
  if (!Number.isFinite(index)) return 0;

  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

export function nextSentence(count: number, index: number): number {
  const current = clampSentence(count, index);
  if (current < 0) return -1;

  return Math.min(count - 1, current + 1);
}

export function prevSentence(count: number, index: number): number {
  const current = clampSentence(count, index);
  if (current < 0) return -1;

  return Math.max(0, current - 1);
}

/**
 * Клик по предложению: играется то, по которому кликнули, даже если оно уже
 * звучит. Возврат к нему же — это «перемотать в начало», а не «ничего», иначе
 * повтор последнего предложения после окончания был бы невозможен.
 * Из пустого рассказа адреса нет: -1.
 */
export function clickSentence(count: number, index: number): number {
  return clampSentence(count, index);
}

// ---------------------------------------------------------------------------
// Плеер как конечный автомат
// ---------------------------------------------------------------------------

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended';

export type PlayerEvent =
  | { type: 'play' }
  | { type: 'loaded' }
  | { type: 'loaded-paused' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'finish' }
  | { type: 'fail' }
  | { type: 'stop' };

/**
 * Таблица переходов. Ноль в ячейке — переход запрещён.
 *
 * Почему таблица, а не набор if: озвучка асинхронная (useTts отдаёт звук через
 * 0.4–6 с или уходит на голос браузера), и события приходят в произвольном
 * порядке. Без явной таблицы «пауза» из idle уходила бы в паузу без звука, а
 * поздний ответ сервера возвращал бы в playing после того, как человек нажал
 * «стоп» — и озвучка из прошлого предложения звучала бы поверх нового.
 */
const TRANSITIONS: Record<PlayerState, Partial<Record<PlayerEvent['type'], PlayerState>>> = {
  idle: { play: 'loading' },
  loading: { loaded: 'playing', 'loaded-paused': 'paused', fail: 'idle', stop: 'idle', pause: 'loading' },
  playing: { pause: 'paused', finish: 'ended', fail: 'idle', stop: 'idle', play: 'loading' },
  paused: { resume: 'playing', play: 'loading', stop: 'idle', fail: 'idle' },
  ended: { play: 'loading', stop: 'idle' },
};

/** Следующее состояние или null, если такой переход в текущем состоянии запрещён. */
export function transition(state: PlayerState, event: PlayerEvent): PlayerState | null {
  return TRANSITIONS[state]?.[event.type] ?? null;
}

/** Можно ли отправить событие в это состояние — для disabled кнопок. */
export function canAccept(state: PlayerState, event: PlayerEvent['type']): boolean {
  return transition(state, { type: event } as PlayerEvent) !== null;
}

export function isActive(state: PlayerState): boolean {
  return state === 'playing' || state === 'paused' || state === 'loading';
}

/** Подпись главной кнопки: по состоянию, а не по флагу «играет/не играет». */
export function primaryActionLabel(state: PlayerState): string {
  switch (state) {
    case 'playing':
      return 'Пауза';
    case 'paused':
      return 'Продолжить';
    case 'loading':
      return 'Озвучиваю…';
    case 'ended':
      return 'Слушать снова';
    default:
      return 'Слушать';
  }
}

// ---------------------------------------------------------------------------
// Подсветка по прогрессу
// ---------------------------------------------------------------------------

/**
 * Длительность предложения без аудио. Реальные тайминги приходят из элемента
 * Audio, но до первого воспроизведения (и в браузерном голосе, где время узнать
 * нельзя) нужна оценка: ~2.7 слова в секунду — темп AriaNeural на rate=-10%.
 */
const WORDS_PER_SECOND = 2.7;
const MIN_SENTENCE_SECONDS = 0.8;

export function estimateDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;

  return Math.max(MIN_SENTENCE_SECONDS, words / WORDS_PER_SECOND);
}

export interface SentenceTiming {
  index: number;
  start: number;
  end: number;
}

/** Тайминги предложений: каждое следующее начинается там, где кончилось предыдущее. */
export function sentenceTimings(
  sentences: readonly ListeningSentence[],
  durations?: ReadonlyMap<number, number>,
): SentenceTiming[] {
  const timings: SentenceTiming[] = [];
  let cursor = 0;

  for (const sentence of sentences) {
    const measured = durations?.get(sentence.index);
    const length = measured && measured > 0 ? measured : estimateDuration(sentence.text);

    timings.push({ index: sentence.index, start: cursor, end: cursor + length });
    cursor += length;
  }

  return timings;
}

/**
 * Какое предложение звучит на моменте `seconds`.
 *
 * Границы полуоткрытые: в момент 0 звучит первое предложение, в момент ровно
 * end первого — уже второе. Иначе на стыке два предложения подсвечивались бы
 * одновременно. За концом звучания остаётся последнее предложение — иначе
 * подсветка «уезжала» бы в null за мгновение до onended и мигала.
 */
export function activeSentenceAt(timings: readonly SentenceTiming[], seconds: number): number {
  if (timings.length === 0) return -1;
  if (!Number.isFinite(seconds) || seconds <= 0) return timings[0].index;

  for (const timing of timings) {
    if (seconds < timing.end) return timing.index;
  }

  return timings[timings.length - 1].index;
}

/** Начало предложения — цель для перемотки кликом. */
export function seekTarget(timings: readonly SentenceTiming[], index: number): number {
  const timing = timings.find((item) => item.index === index);

  return timing ? timing.start : 0;
}

export function totalDuration(timings: readonly SentenceTiming[]): number {
  return timings.length === 0 ? 0 : timings[timings.length - 1].end;
}

/** Оставшееся время словами: «3 мин», «1 мин 20 с», «40 с». */
export function remainingLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 с';

  const total = Math.ceil(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;

  if (minutes === 0) return `${rest} с`;
  if (rest === 0) return `${minutes} мин`;

  return `${minutes} мин ${rest} с`;
}

/** Доля проигранного для полосы прогресса (0..1). Пустой рассказ — 0, не NaN. */
export function progressFraction(timings: readonly SentenceTiming[], seconds: number): number {
  const total = totalDuration(timings);
  if (total <= 0 || !Number.isFinite(seconds)) return 0;

  return Math.min(1, Math.max(0, seconds / total));
}

// ---------------------------------------------------------------------------
// Сохранённое место
// ---------------------------------------------------------------------------

export interface ListeningPosition {
  storyId: string;
  sentence: number;
  rate: PlaybackRate;
}

/**
 * Место прослушивания в localStorage. Разбор защитный: испорченное значение
 * (старый формат, ручная правка, другой рассказ) не должно ронять страницу —
 * просто начинаем сначала.
 */
export function parsePosition(raw: string | null, storyId: string): ListeningPosition | null {
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  if (record.storyId !== storyId) return null;
  if (typeof record.sentence !== 'number' || !Number.isFinite(record.sentence)) return null;

  return {
    storyId,
    sentence: Math.max(0, Math.trunc(record.sentence)),
    rate: normalizeRate(record.rate),
  };
}

export function serializePosition(position: ListeningPosition): string {
  return JSON.stringify(position);
}

/** Ключ на рассказ отдельный: у каждого своё место, скорость общая на привычку. */
export function positionKey(storyId: string): string {
  return `lexicon.listening.position.${storyId}`;
}

export const RATE_STORAGE_KEY = 'lexicon.listening.rate';

// ---------------------------------------------------------------------------
// Режимы прослушивания
// ---------------------------------------------------------------------------

/**
 * «Весь рассказ» — очередь идёт сама, предложение за предложением до конца.
 * «По предложению» — место стоит, пока человек не нажмёт «дальше»: так слушают
 * одну фразу несколько раз, пока не разберут её на слух.
 */
export const CHECK_MODES = ['story', 'sentence'] as const;

export type ListeningMode = (typeof CHECK_MODES)[number];

export const DEFAULT_MODE: ListeningMode = 'story';

export function normalizeMode(value: unknown): ListeningMode {
  return value === 'sentence' ? 'sentence' : DEFAULT_MODE;
}

export function nextMode(current: ListeningMode): ListeningMode {
  return current === 'story' ? 'sentence' : 'story';
}

export type MoveDirection = 'next' | 'prev';

/**
 * Новое место после шага очереди. Отдельно от `nextSentence`, потому что режим
 * меняет смысл «следующего»: в режиме по предложению без явной команды очередь
 * не двигается вовсе, и автопереход после end звука его бы проскочил.
 */
export function moveCurrent(
  mode: ListeningMode,
  count: number,
  index: number,
  direction?: MoveDirection,
): number {
  const current = clampSentence(count, index);
  if (current < 0) return -1;

  if (direction === 'next') return nextSentence(count, current);
  if (direction === 'prev') return prevSentence(count, current);
  // «весь рассказ» — следующий сам; «по предложению» — остаёмся на месте
  return mode === 'story' ? nextSentence(count, current) : current;
}

// ---------------------------------------------------------------------------
// Проверка понимания
// ---------------------------------------------------------------------------

/**
 * Нормализация ответа: регистр, пунктуация, лишние пробелы. Дефис становится
 * пробелом, апостроф убирается, поэтому «well-known» и «well known»
 * засчитываются одинаково, а «isn’t» и «isnt» — тоже: человек набирает на
 * русской раскладке и с телефона, где апостроф получить дорого.
 *
 * Буквы не задаются классом \p{L}: у проекта target ниже ES6, и tsc запрещает
 * флаг `u` — поэтому всё, что не ASCII-буква и не буква кириллицы, считается
 * разделителем. Для английских слов и русского перевода этого достаточно.
 */
export function collapsePunctuation(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[’'`]/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/[^0-9a-z\u0400-\u04ff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeAnswer(text: string | null | undefined): string {
  return collapsePunctuation(text ?? '');
}

export type AnswerStatus = 'correct' | 'close' | 'wrong' | 'empty';

/**
 * Допуск на опечатку: одно изменение на слово от 4 букв и на 7 — два.
 * «towle» → «towel» это опечатка в наборе, а не непонимание на слух; человеку
 * нужно сказать «почти, проверь буквы», иначе он решит, что ослышался.
 * Отдельные короткие слова («a», «it», «go») — только точное совпадение:
 * у них любое изменение меняет слово целиком.
 */
export function typoTolerance(answer: string): number {
  const length = answer.length;
  if (length >= 7) return 2;
  if (length >= 4) return 1;

  return 0;
}

/**
 * Что считается опечаткой при наборе: пропущенная и лишняя буква и перестановка
 * соседних. Замена буквы (warm/worm, kitten/mitten) — уже другое слово, и
 * засчитывать её как «почти верно» значило бы соврать про понимание на слух.
 * Расстояние Левенштейна этого не различает — ему без разницы, какое
 * исправление дешевле, — поэтому сравнение разбито на два частных случая.
 */
function isTypo(expected: string, actual: string, budget: number): boolean {
  if (expected === actual) return true;
  if (budget <= 0) return false;

  // лишняя буква у человека
  if (actual.length === expected.length + 1) {
    for (let index = 0; index < actual.length; index += 1) {
      if (actual.slice(0, index) + actual.slice(index + 1) === expected) return true;
    }
  }

  // человек пропустил букву
  if (actual.length + 1 === expected.length) {
    for (let index = 0; index < expected.length; index += 1) {
      if (expected.slice(0, index) + expected.slice(index + 1) === actual) return true;
    }
  }

  // перестановка соседних букв
  if (actual.length === expected.length) {
    for (let index = 0; index < expected.length - 1; index += 1) {
      if (expected[index] !== expected[index + 1] && expected[index] === actual[index + 1] && expected[index + 1] === actual[index]) {
        return isTypo(
          expected.slice(0, index) + expected[index + 1] + expected[index] + expected.slice(index + 2),
          actual,
          budget - 1,
        );
      }
    }
  }

  return false;
}

/** Похоже ли слово на верное в пределах допуска. */
export function isCloseWord(expected: string, actual: string): boolean {
  const tolerance = typoTolerance(expected);

  if (expected === actual) return true;
  if (tolerance === 0) return false;
  // резкая разница в длине — это уже другое слово, независимо от правок
  if (Math.abs(expected.length - actual.length) > tolerance) return false;

  return isTypo(expected, actual, tolerance);
}

/**
 * Вердикт по вписанному ответу.
 *
 * Порядок важен: пустой ответ проверяется ДО сравнения, иначе повторная
 * «Проверка» без ввода получала бы частичный зачёт за ничего.
 */
export function answerStatus(expected: string, answer: string | null | undefined): AnswerStatus {
  const given = normalizeAnswer(answer);
  if (!given) return 'empty';

  const target = normalizeAnswer(expected);
  if (!target) return 'empty';
  if (given === target) return 'correct';

  const expectedWords = target.split(' ');
  const givenWords = given.split(' ');

  // фразы сравниваем слово-в-слово: «он пришел домой» против «он пришел домой!»
  // — точное совпадение, а пропуск слова в фразе — уже неверно
  if (expectedWords.length > 1 || givenWords.length > 1) {
    if (expectedWords.length !== givenWords.length) return 'wrong';

    const allClose = expectedWords.every((word, index) => isCloseWord(word, givenWords[index]));

    return allClose ? 'close' : 'wrong';
  }

  return isCloseWord(target, given) ? 'close' : 'wrong';
}

/**
 * Засчитывается ли ответ (точный или с опечаткой) — для кнопки «Дальше». */
export function isClozeComplete(expected: string, answer: string | null | undefined): boolean {
  const status = answerStatus(expected, answer);

  return status === 'correct' || status === 'close';
}

export interface GapQuestion {
  /** Предложение с пропуском вместо слова */
  display: string;
  /** Что человек должен услышать: слово в исходной форме, без пунктуации */
  expected: string;
}

/** Короче этого пропуск не имеет смысла: «a»/«it» угадываются без понимания. */
const MIN_GAP_WORD_LENGTH = 2;

/**
 * Предложение с пропуском слова — для режима «впишите слово».
 *
 * Слово ищется по границам, но пунктуация в конце остаётся на месте: точка
 * относится к предложению, а не к слову, и поле ввода с ней «слипается».
 * Возвращает null, если слова в предложении нет или оно слишком короткое —
 * тогда плееру нужно другое предложение, а не пропуск, который нечего проверять.
 */
export function gapQuestion(sentence: string, word: string): GapQuestion | null {
  const target = (word ?? '').trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
  if (!target || target.length < MIN_GAP_WORD_LENGTH) return null;

  const source = (sentence ?? '').trim();
  if (!source) return null;

  const pattern = new RegExp(`(?<![A-Za-z'])${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z'])`, 'i');
  const match = pattern.exec(source);
  if (!match) return null;

  const display = `${source.slice(0, match.index)}___${source.slice(match.index + match[0].length)}`;

  return { display, expected: match[0] };
}

/**
 * Ввод в поле пропуска. Отдельная функция, а не `onChange={setValue}`: мобильная
 * клавиатура присылает композицию IME и повторяющиеся символы, а человек должен
 * видеть ровно то, что он набрал, без «умной» чистки по ходу.
 *
 * `removed` — это Backspace с известным фрагментом (выделение). Пустая строка в
 * `input` на мобильных означает удаление без фрагмента, а не «ничего не нажато»:
 * поэтому проверка на пустоту стоит после решения «удаление или ввод».
 */
export function typeAnswer(value: string, input: string, removed = false): string {
  if (removed) {
    if (!input) return value.slice(0, -1);
    return value.endsWith(input) ? value.slice(0, -input.length) : value;
  }

  if (!input) return value;
  if (value.endsWith(input)) return value;

  return `${value}${input}`;
}

// ---------------------------------------------------------------------------
// Выбор рассказа
// ---------------------------------------------------------------------------

export const LAST_STORY_KEY = 'lexicon.listening.story';

export function serializeLanding(value: { storyId: string }): string {
  return JSON.stringify({ storyId: value.storyId });
}

/**
 * Последний открытый рассказ из localStorage. Проверяется по списку сида:
 * рассказ могли убрать, и тогда лучше открыть первый, чем пустой экран.
 */
export function parseLastStory(raw: string | null, storyCount: number): string | null {
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null) return null;

  const storyId = (value as Record<string, unknown>).storyId;
  if (typeof storyId !== 'string' || !storyId.trim()) return null;
  if (storyCount <= 0) return null;

  return storyId;
}

// ---------------------------------------------------------------------------
// Честность бейджа
// ---------------------------------------------------------------------------

export type FallbackReason = 'timeout' | 'quota' | 'error';

/** Почему играет браузерный голос. Без причины бейдж выглядит как поломка. */
export const DEFAULT_FALLBACK_TEXT: Record<FallbackReason, string> = {
  timeout: 'Серверный голос не ответил за 6 секунд — читает голос браузера.',
  quota: 'Бесплатная квота озвучки на сегодня исчерпана — читает голос браузера.',
  error: 'Серверный голос недоступен — читает голос браузера.',
};

export function fallbackReasonLabel(reason: FallbackReason): string {
  return DEFAULT_FALLBACK_TEXT[reason];
}
