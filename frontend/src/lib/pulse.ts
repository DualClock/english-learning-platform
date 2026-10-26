/*
 * Feedback Pulse (W4.1) — чистая логика одного inline-вопроса в читалке.
 *
 * Здесь нет ни React, ни fetch, ни localStorage: только те три решения, которые
 * легко сломать правкой текста или UI и которые нельзя проверить «на глаз»:
 *  1. какой вопрос показывать и совпадают ли с ним кнопки;
 *  2. какие значения уходят в meta (серверный закрытый набор);
 *  3. показывать ли блок второй раз.
 *
 * Компонент (`components/feedback/BetaPulse.tsx`) читает и пишет localStorage и
 * ходит на сервер, но ни одно из решений выше не принимает сам.
 *
 * Тип `FeedbackCheckpoint` импортируется как type: у этого модуля нет ни одного
 * рантайм-импорта, поэтому юнит подаёт список чекпоинтов сам и проверяет
 * разъезд копии с кнопками на подставном тексте, не трогая beta.ts.
 *
 * Почему вообще pulse, а не виджет с формой: микроопрос из 2–3 вопросов даёт
 * 15,97% ответов против 6,87% при семи и больше, а in-app промпт — 18,69%
 * против 7,64% у виджета (Survicate, 4 332 опроса). То есть вопрос обязан быть
 * один, в момент чтения и без «заполните форму».
 */

import type { FeedbackCheckpoint } from './beta';

/** Имена событий — зеркало AnalyticsController. Любая опечатка = 400 на записи. */
export const PULSE_EVENTS = {
  seen: 'beta_pulse_seen',
  answered: 'beta_pulse_answered',
  dismissed: 'beta_pulse_dismissed',
} as const;

export type PulseEventName = (typeof PULSE_EVENTS)[keyof typeof PULSE_EVENTS];

/**
 * Закрытый набор, который сервер готов принять в meta у `beta_pulse_answered`
 * (см. AnalyticsController.PulseAnswerOptions). Свободный текст там не нужен
 * намеренно: чужая фраза в таблице событий — это отзыв, который никто не
 * читает, и потенциальный PII там, где мы его не обещали.
 */
export type PulseAnswer = 'word' | 'repetition' | 'text' | 'other';

export const PULSE_ANSWERS: readonly PulseAnswer[] = ['word', 'repetition', 'text', 'other'];

/** Ровно три кнопки: четвёртая («свой вариант») превратила бы клик в анкету. */
export interface PulseOption {
  answer: PulseAnswer;
  label: string;
}

export const PULSE_OPTIONS: readonly PulseOption[] = [
  { answer: 'word', label: 'Перевод слова' },
  { answer: 'repetition', label: 'Очередь повторения' },
  { answer: 'text', label: 'Сама глава' },
];

/**
 * Чем текст вопроса обязан называть каждый вариант. Регулярки сознательно
 * короткие и в родительном падеже: в формулировке «перевод слова, очередь
 * повторения или сама глава» склоняются именно они.
 *
 * Это не украшение: блок, у которого кнопка не соответствует вопросу, даёт
 * осмысленный на вид ответ, который ничего не означает.
 */
const OPTION_MATCHERS: Record<Exclude<PulseAnswer, 'other'>, RegExp> = {
  word: /перевод\w*\s+слов/i,
  repetition: /повторени/i,
  text: /глав/i,
};

/** Чекпоинт, из которого берём формулировку: день 4 когорты, «что бесит». */
export const PULSE_CHECKPOINT_ID = 'feedback-day-4';

/** Ключ localStorage: на один аккаунт, а не на браузер — под одним логином их может быть два. */
export const PULSE_STORAGE_PREFIX = 'lexicon:pulse:';

export function pulseStorageKey(userId: string): string {
  return `${PULSE_STORAGE_PREFIX}${userId}`;
}

/**
 * Первое предложение вопроса — то, до чего стоит знак вопроса.
 *
 * Вторая фраза чекпоинта («Достаточно одной фразы.») относится к развёрнутому
 * отзыву на /beta, где человек действительно пишет. В inline-блоке на три
 * кнопки она обещает действие, которого блок не предлагает, поэтому в UI
 * уходит только сам вопрос.
 */
export function pulseQuestionText(ask: string): string {
  const mark = ask.indexOf('?');
  return mark === -1 ? ask.trim() : ask.slice(0, mark + 1).trim();
}

export interface PulseBlock {
  question: string;
  options: readonly PulseOption[];
}

/**
 * Собрать блок из чекпоинтов когорты. null — значит «показывать нечего»:
 *  - нужный чекпоинт исчез или переименован;
 *  - текст вопроса больше не называет все три варианта.
 *
 * Молчаливый отказ здесь честнее двух вещей: показывать кнопки «Перевод слова»
 * под вопросом про другую боль и показывать вопрос, скопированный с /beta,
 * который редактор уже переписал.
 */
export function buildPulseBlock(
  checkpoints: readonly FeedbackCheckpoint[],
): PulseBlock | null {
  const checkpoint = checkpoints.find((item) => item.id === PULSE_CHECKPOINT_ID);
  if (!checkpoint) return null;

  const question = pulseQuestionText(checkpoint.ask);
  if (question.length === 0) return null;

  for (const option of PULSE_OPTIONS) {
    if (option.answer === 'other') continue;
    const matcher = OPTION_MATCHERS[option.answer];
    if (!matcher.test(question)) return null;
  }

  return { question, options: PULSE_OPTIONS };
}

/** Что пишет клиент в meta: код варианта для ответа, пусто/dismiss для показа. */
export function pulseMeta(event: PulseEventName, answer?: PulseAnswer | null): string {
  if (event === PULSE_EVENTS.answered) {
    if (!answer || !PULSE_ANSWERS.includes(answer)) {
      // Клиент обязан вызвать это с валидным вариантом; если пришёл мусор,
      // пустая строка уйдёт на сервер и будет 400 — лучше явная ошибка в
      // сети, чем свободный текст в аналитике.
      return '';
    }
    return answer;
  }
  return event === PULSE_EVENTS.dismissed ? 'dismiss' : '';
}

/** Ответ читателя в блоке: null — ещё не ответил. */
export interface PulseState {
  seen: boolean;
  answered: PulseAnswer | null;
  dismissed: boolean;
}

export const EMPTY_PULSE_STATE: PulseState = { seen: false, answered: null, dismissed: false };

/**
 * Разбор строки из localStorage. Мусор, чужая версия и обрезанная запись
 * означают одно: состояния нет, то есть блок может быть показан (и серверное
 * семисуточное правило решит, показывать ли). Падать здесь не на чем —
 * читалка не должна падать из-за флага аналитики.
 */
export function parsePulseState(raw: string | null | undefined): PulseState {
  if (!raw) return { ...EMPTY_PULSE_STATE };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_PULSE_STATE };
  }

  if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_PULSE_STATE };

  const record = parsed as Record<string, unknown>;
  const answered = record.answered;

  return {
    seen: record.seen === true,
    dismissed: record.dismissed === true,
    answered:
      typeof answered === 'string' && (PULSE_ANSWERS as readonly string[]).includes(answered)
        ? (answered as PulseAnswer)
        : null,
  };
}

export function serializePulseState(state: PulseState): string {
  return JSON.stringify(state);
}

/**
 * Показывать ли вопрос сейчас.
 *
 * «Один раз на пользователя» держат два слоя, и оба настоящие:
 *  - сервер (7 суток на любого из трёх pulse-событий) — против трёх устройств;
 *  - этот флаг (против того же браузера) — против случая, когда человек
 *    увидел блок, пролистнул и вернулся к книге через минуту: второй показ
 *    того же вопроса в той же сессии читается как навязчивость, а не как
 *    вежливость.
 *
 * После ответа и после крестика вопрос не возвращается никогда, даже когда
 * семисуточная пауза истечёт: answered/dismissed — это уже мнение, а не
 * «не успел».
 */
export function shouldShowPulse(args: {
  userId: string | null;
  serverEligible: boolean | null;
  state: PulseState;
}): boolean {
  if (!args.userId) return false;
  if (args.state.seen || args.state.answered !== null || args.state.dismissed) return false;
  return args.serverEligible === true;
}

/**
 * Блок живёт на той странице, где появился.
 *
 * Перелистал страницу — вопроса нет. Без этого правила одна и та же подпись с
 * тремя кнопками торчала бы внизу каждой страницы до конца книги, и «один
 * ненавязчивый вопрос» превратился бы в баннер. Повторный возврат на ту же
 * страницу блок не убирает: человек мог уйти в словарь, обдумывая ответ.
 */
export function pulseShowsOnPage(openedPage: number | null, currentPage: number): boolean {
  return openedPage !== null && openedPage === currentPage;
}

/**
 * Что сделать с сервером при открытии блока. Порядок важен: `seen` пишется
 * ровно один раз на показ, иначе знаменатель конверсии pulse считается по
 * перемонтированиям читалки, а не по людям.
 */
export function pulseEventsOnAnswer(answer: PulseAnswer): { event: PulseEventName; meta: string } {
  return { event: PULSE_EVENTS.answered, meta: pulseMeta(PULSE_EVENTS.answered, answer) };
}
