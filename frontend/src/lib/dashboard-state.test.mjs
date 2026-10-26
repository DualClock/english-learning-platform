import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MISSING_VALUE,
  MIN_COMPETITIVE_PARTICIPANTS,
  displayCount,
  reviewDescription,
  reviewHeadline,
  shouldRenderLeague,
  shouldRenderStreak,
  widgetState,
} from '../components/dashboard/dashboard-state.ts';

// ---- widgetState: «нет данных» никогда не выдаёт себя за ноль ----------------

test('пока ответа не было — это загрузка, а не пусто', () => {
  assert.equal(widgetState({ data: undefined, error: null }), 'loading');
});

test('ошибка важнее данных: кэш мог прийти, а запрос упасть', () => {
  assert.equal(widgetState({ data: { totalCount: 0 }, error: 'boom' }), 'error');
  assert.equal(widgetState({ data: undefined, error: 'boom' }), 'error');
});

test('выключенный запрос не считается ни ошибкой, ни пустотой', () => {
  assert.equal(widgetState({ data: undefined, error: null, enabled: false }), 'loading');
});

test('null пришедший с сервера — пусто, undefined — ещё не пришёл', () => {
  assert.equal(widgetState({ data: null, error: null }), 'empty');
  assert.equal(widgetState({ data: undefined, error: null }), 'loading');
});

test('предикат пустоты отличает «нет карточек» от «нет ответа»', () => {
  const isEmpty = (list) => list.length === 0;
  assert.equal(widgetState({ data: [], error: null, isEmpty }), 'empty');
  assert.equal(widgetState({ data: ['a'], error: null, isEmpty }), 'ready');
});

// ---- displayCount: прочерк, а не ложный ноль --------------------------------

test('отсутствующее число рисуется прочерком, а не нулём', () => {
  assert.equal(displayCount(null), MISSING_VALUE);
  assert.equal(displayCount(undefined), MISSING_VALUE);
  assert.equal(MISSING_VALUE, '—');
});

test('настоящий ноль остаётся нулём: это утверждение о данных', () => {
  assert.equal(displayCount(0), '0');
  assert.equal(displayCount(12), '12');
});

test('NaN и бесконечность не попадают в интерфейс', () => {
  assert.equal(displayCount(Number.NaN), MISSING_VALUE);
  assert.equal(displayCount(Number.POSITIVE_INFINITY), MISSING_VALUE);
});

// ---- reviewHeadline: «Всё повторено» не показывается при ошибке -------------

test('при ошибке повторение не говорит «всё сделано»', () => {
  const headline = reviewHeadline('error', 0);
  assert.ok(!/повторено|сделано|нечего/i.test(headline), `ложное «всё хорошо»: ${headline}`);
  assert.match(headline, /Не удалось/);
});

test('новому аккаунту говорим «добавьте слова», а не «всё повторено»', () => {
  const headline = reviewHeadline('empty', 0);
  assert.match(headline, /нечего/i);
  const description = reviewDescription('empty', 0);
  assert.match(description, /Добавьте/);
  assert.ok(!/Всё повторено/i.test(description));
});

test('активному пользователю, сделавшему всё, говорим про завтра', () => {
  assert.match(reviewDescription('ready', 0), /Завтра/);
});

test('слова к повторению называются числом', () => {
  assert.match(reviewHeadline('ready', 7), /7/);
});

// ---- стрик и лига: не показывать то, что читается как «сервис мёртв» -------

test('стрик рисуем только когда есть что показывать', () => {
  assert.equal(shouldRenderStreak('loading'), false);
  assert.equal(shouldRenderStreak('error'), false);
  assert.equal(shouldRenderStreak('empty'), true);
  assert.equal(shouldRenderStreak('ready'), true);
});

test('лига не рисуется, пока в группе меньше порога участников', () => {
  assert.equal(shouldRenderLeague(0), false);
  assert.equal(shouldRenderLeague(3), false);
  assert.equal(shouldRenderLeague(MIN_COMPETITIVE_PARTICIPANTS - 1), false);
});

test('лига рисуется на пороге и выше', () => {
  assert.equal(shouldRenderLeague(MIN_COMPETITIVE_PARTICIPANTS), true);
  assert.equal(shouldRenderLeague(31), true);
});

test('неизвестное число участников не превращается в ноль участников', () => {
  // null/undefined — «мы не знаем», и это не повод ни рисовать, ни прятать по
  // ошибке данных: блок просто не показывается до получения ответа.
  assert.equal(shouldRenderLeague(null), false);
  assert.equal(shouldRenderLeague(undefined), false);
});
