import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EMPTY_PULSE_STATE,
  PULSE_ANSWERS,
  PULSE_CHECKPOINT_ID,
  PULSE_EVENTS,
  PULSE_OPTIONS,
  PULSE_STORAGE_PREFIX,
  buildPulseBlock,
  parsePulseState,
  pulseEventsOnAnswer,
  pulseMeta,
  pulseQuestionText,
  pulseShowsOnPage,
  pulseStorageKey,
  serializePulseState,
  shouldShowPulse,
} from './pulse.ts';
import { FEEDBACK_CHECKPOINTS } from './beta.ts';

/*
 * Контракт микроопроса (W4.1).
 *
 * Три вещи, которые ломаются молча и без ошибок в консоли: текст вопроса и
 * кнопки разъезжаются (сервер принимает четыре кода, UI показывает три, а
 * подпись спрашивает про другое), произвольный текст уезжает в meta (сервер
 * ответит 400, и мы потеряем ответ, ничего не заметив), блок показывается
 * второй раз тому же человеку (мера раздражения вместо меры мнений).
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(join(here, ...segments), 'utf8');

// В Reader 3.0 страница книги — тонкая оболочка, а вопрос живёт в разборе
// главы: там читатель закончил главу и готов ответить одной кнопкой.
const chapterEnd = read('..', 'components', 'reader', 'ChapterEndSheet.tsx');
const pulseComponent = read('..', 'components', 'feedback', 'BetaPulse.tsx');
const serverController = read(
  '..',
  '..',
  '..',
  'EnglishLearningPlatform.API',
  'Controllers',
  'AnalyticsController.cs'
);

// ---- имена и закрытый набор --------------------------------------------------

test('имена событий совпадают с серверным whitelist', () => {
  assert.deepEqual(
    [PULSE_EVENTS.seen, PULSE_EVENTS.answered, PULSE_EVENTS.dismissed],
    ['beta_pulse_seen', 'beta_pulse_answered', 'beta_pulse_dismissed']
  );

  // Клиентский список — зеркало серверного: имя, которое сервер не знает,
  // отклоняется 400, и ответ человека просто исчезает.
  for (const name of [PULSE_EVENTS.seen, PULSE_EVENTS.answered, PULSE_EVENTS.dismissed]) {
    assert.match(
      serverController,
      new RegExp(`"${name}"`),
      `сервер не знает событие ${name}`
    );
  }
});

test('кнопок ровно три, и все коды принимает сервер', () => {
  assert.equal(PULSE_OPTIONS.length, 3, 'микроопрос перестал быть микроопросом');
  assert.equal(new Set(PULSE_OPTIONS.map((o) => o.answer)).size, 3);

  for (const option of PULSE_OPTIONS) {
    assert.ok(PULSE_ANSWERS.includes(option.answer), `${option.answer} вне закрытого набора`);
    assert.match(
      serverController,
      new RegExp(`"${option.answer}"`),
      `сервер не принимает вариант ${option.answer}`
    );
    assert.ok(option.label.trim().length > 0);
  }

  // other существует в наборе, но кнопкой не является: четвёртая кнопка
  // «свой вариант» — это уже анкета.
  assert.ok(PULSE_ANSWERS.includes('other'));
  assert.equal(PULSE_OPTIONS.some((o) => o.answer === 'other'), false);
});

test('meta: ответ несёт код варианта, показ и закрытие — ничего лишнего', () => {
  assert.equal(pulseMeta(PULSE_EVENTS.answered, 'word'), 'word');
  assert.equal(pulseMeta(PULSE_EVENTS.seen), '');
  assert.equal(pulseMeta(PULSE_EVENTS.dismissed), 'dismiss');

  // Свободный текст не уходит даже по случайности: пустая строка даст на
  // сервере 400, а не чужую фразу в аналитике.
  assert.equal(pulseMeta(PULSE_EVENTS.answered, 'что бесит сильнее всего'), '');
  assert.equal(pulseMeta(PULSE_EVENTS.answered, null), '');
  assert.equal(pulseEventsOnAnswer('repetition').meta, 'repetition');
  assert.equal(pulseEventsOnAnswer('repetition').event, PULSE_EVENTS.answered);
});

// ---- текст вопроса -----------------------------------------------------------

test('вопрос берётся из чекпоинта когорты и называет все три варианта', () => {
  const block = buildPulseBlock(FEEDBACK_CHECKPOINTS);
  const checkpoint = FEEDBACK_CHECKPOINTS.find((item) => item.id === PULSE_CHECKPOINT_ID);
  assert.ok(checkpoint, `чекпоинт ${PULSE_CHECKPOINT_ID} пропал с /beta`);

  assert.ok(block, 'блок не собрался: копия чекпоинта разъехалась с кнопками');
  assert.equal(block.question, pulseQuestionText(checkpoint.ask));
  assert.match(block.question, /^\D+\?$/);
  assert.doesNotMatch(block.question, /одной фразы/i, 'просим фразу там, где три кнопки');

  assert.match(block.question, /перевод\w* слов/i);
  assert.match(block.question, /повторени/i);
  assert.match(block.question, /глав/i);
  assert.equal(block.options.length, 3);
});

test('pulseQuestionText режет первое предложение вопроса', () => {
  assert.equal(pulseQuestionText('Что бесит? Напишите фразу.'), 'Что бесит?');
  assert.equal(pulseQuestionText('Без знака вопроса'), 'Без знака вопроса');
  assert.equal(pulseQuestionText('  Один? Два?  '), 'Один?');
});

test('копия чекпоинта, потерявшая один вариант, снимает блок с показа', () => {
  const base = FEEDBACK_CHECKPOINTS.find((item) => item.id === PULSE_CHECKPOINT_ID);
  assert.ok(base);

  const drift = [{ ...base, ask: 'Что бесит сильнее всего: формат или обложка? Достаточно одной фразы.' }];
  assert.equal(buildPulseBlock(drift), null, 'кнопки не соответствуют вопросу');

  // Чекпоинт переименовали или убрали — тоже null: блок не имеет права
  // выдумывать себе текст.
  assert.equal(buildPulseBlock([]), null);
  assert.equal(buildPulseBlock([{ ...base, id: 'feedback-day-99' }]), null);
});

// ---- «не показывать второй раз» ----------------------------------------------

const open = { userId: 'u-1', accessToken: 'token', serverEligible: true };

test('блок показывается один раз: после ответа, закрытия и уже виденного — нет', () => {
  assert.equal(shouldShowPulse({ ...open, state: EMPTY_PULSE_STATE }), true);

  assert.equal(shouldShowPulse({ ...open, state: { seen: true, answered: null, dismissed: false } }), false);
  assert.equal(shouldShowPulse({ ...open, state: { seen: true, answered: 'word', dismissed: false } }), false);
  assert.equal(shouldShowPulse({ ...open, state: { seen: false, answered: null, dismissed: true } }), false);

  // Гость и читатель без токена не получают ни блока, ни запроса на сервер.
  assert.equal(shouldShowPulse({ ...open, userId: null }), false);
  assert.equal(shouldShowPulse({ ...open, accessToken: null }), false);
});

test('частоту решает сервер: ineligible снимает блок даже при пустом флаге', () => {
  assert.equal(shouldShowPulse({ ...open, serverEligible: false, state: EMPTY_PULSE_STATE }), false);
  // Ответ ещё не пришёл — показывать нельзя: блок без данных о частоте это
  // второй и третий показ на трёх устройствах.
  assert.equal(shouldShowPulse({ ...open, serverEligible: null, state: EMPTY_PULSE_STATE }), false);
});

test('блок живёт на странице, где появился, и не превращается в баннер', () => {
  assert.equal(pulseShowsOnPage(7, 7), true);
  assert.equal(pulseShowsOnPage(7, 8), false, 'перелистнул — вопроса нет');
  assert.equal(pulseShowsOnPage(7, 6), false);
  assert.equal(pulseShowsOnPage(null, 7), false, 'закрытый крестиком не возвращается');
});

test('ключ состояния привязан к аккаунту, а не к браузеру', () => {
  assert.equal(pulseStorageKey('u-1'), `${PULSE_STORAGE_PREFIX}u-1`);
  assert.notEqual(pulseStorageKey('u-1'), pulseStorageKey('u-2'));
});

test('состояние переживает перезагрузку и не боится мусора', () => {
  const state = { seen: true, answered: 'text', dismissed: false };
  assert.deepEqual(parsePulseState(serializePulseState(state)), state);

  for (const garbage of [null, undefined, '', '{', '[]', 'null', 'строкой', '{}']) {
    assert.deepEqual(parsePulseState(garbage), EMPTY_PULSE_STATE, `мусор ${garbage} не должен ломать читалку`);
  }

  // Неизвестный вариант из испорченной записи не уезжает в meta: он null.
  assert.equal(parsePulseState('{"seen":true,"answered":"что угодно"}').answered, null);
  assert.equal(parsePulseState('{"seen":true,"dismissed":true}').dismissed, true);
});

// ---- врезка в читалку ---------------------------------------------------------

test('блок стоит в читалке и не прячет контент за анимацией', () => {
  assert.match(pulseComponent, /buildPulseBlock\(/);
  assert.match(pulseComponent, /PULSE_EVENTS\.seen/);
  assert.match(pulseComponent, /openFeedback\(\)/, 'ссылка обязана вести в существующую форму отзыва');

  // Урок SEO-аудита: контент, стартующий с opacity 0, без JS не читается.
  assert.doesNotMatch(pulseComponent, /from ['"]motion\/react['"]/);
  assert.doesNotMatch(pulseComponent, /opacity-0/);
  assert.doesNotMatch(pulseComponent, /initial=\{\{/);
  // Никаких попапов: блок — часть колонки чтения, а не слой поверх неё.
  assert.doesNotMatch(pulseComponent, /fixed inset-0/);
  assert.doesNotMatch(pulseComponent, /aria-modal/);

  // Вставлен в скролл читаемой колонки, рядом с текстом страницы, и знает,
  // на какой странице он появился.
  assert.match(chapterEnd, /<BetaPulse[\s\S]{0,200}page=\{page\}/);
  assert.match(chapterEnd, /userId=\{userId\}/);
});
