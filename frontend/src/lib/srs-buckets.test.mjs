import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LEECH_THRESHOLD,
  RELIABLE_INTERVAL_DAYS,
  SRS_BUCKETS,
  bucketOf,
  distribution,
  formatNextInterval,
  percent,
  pluralRu,
  reliableCount,
  totalOf,
  wordsLabel,
} from './srs-buckets.ts';
import { plural } from './plural.ts';

/*
 * Бакеты SRS: граница, названная неверно, выглядит не как падение, а как
 * «у меня всё в learning» — и человек перестаёт верить цифрам. Поэтому
 * проверяются пары «на границе / на день за границей», совпадение с формулой
 * SM-2 и отсутствие NaN на пустом словаре.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(join(here, ...segments), 'utf8');

test('границы бакетов: 0 / 1 / 7 / 8 / 30 / 31', () => {
  assert.equal(bucketOf(0), 'learning');
  assert.equal(bucketOf(1), 'short');
  assert.equal(bucketOf(7), 'short');
  assert.equal(bucketOf(8), 'medium');
  assert.equal(bucketOf(30), 'medium');
  assert.equal(bucketOf(31), 'long');
});

test('дробный и отрицательный интервал не выпадает из распределения', () => {
  // 7.9 дня — это ещё «1–7»: сервис округляет вниз, UI не должен «прыгать».
  assert.equal(bucketOf(7.9), 'short');
  assert.equal(bucketOf(30.9), 'medium');
  assert.equal(bucketOf(-3), 'learning');
  assert.equal(bucketOf(Number.NaN), 'learning');
});

test('лееч-порог на фронте совпадает с SrsService', () => {
  assert.equal(LEECH_THRESHOLD, 4);
  const service = read('..', '..', '..', 'EnglishLearningPlatform.API', 'Services', 'SrsService.cs');
  assert.match(service, /LeechThreshold\s*=\s*4;/);
});

test('порог «надёжно» — 21 день, а не «больше 30»', () => {
  assert.equal(RELIABLE_INTERVAL_DAYS, 21);
  const service = read('..', '..', '..', 'EnglishLearningPlatform.API', 'Services', 'SrsBreakdownService.cs');
  assert.match(service, /ReliableIntervalDays\s*=\s*21;/);
});

test('distribution раскладывает счётчики сервера по четырём бакетам', () => {
  const dist = distribution({
    totalWords: 10,
    learning: 2,
    short: 3,
    medium: 1,
    long: 4,
  });

  assert.deepEqual(dist, { learning: 2, short: 3, medium: 1, long: 4 });
  assert.equal(totalOf(dist), 10);
});

test('distribution: пустой словарь даёт нули, а не NaN', () => {
  for (const input of [null, undefined, {}]) {
    const dist = distribution(input);
    assert.deepEqual(dist, { learning: 0, short: 0, medium: 0, long: 0 });
    assert.equal(totalOf(dist), 0);
  }
});

test('distribution: мусор и отрицательные значения не протекают в проценты', () => {
  const dist = distribution({
    totalWords: -5,
    learning: -1,
    short: Number.NaN,
    medium: 2,
    long: 1,
  });

  assert.deepEqual(dist, { learning: 0, short: 0, medium: 2, long: 1 });
});

test('distribution: сумма бакетов сходится с totalWords', () => {
  // Сервер отдал только общее число (старый кэш или частичный ответ) —
  // недостача идёт в long, чтобы проценты дали 100, а не 0.
  const dist = distribution({ totalWords: 12, learning: 2, short: 3 });
  assert.equal(totalOf(dist), 12);
  assert.equal(dist.long, 7);
});

test('percent: ноль слов — 0%, а не деление на ноль', () => {
  assert.equal(percent(0, 0), 0);
  assert.equal(percent(5, 0), 0);
  assert.equal(percent(Number.NaN, 10), 0);
});

test('percent округляет и зажимает в 0–100', () => {
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(2, 3), 67);
  assert.equal(percent(10, 10), 100);
  assert.equal(percent(15, 10), 100);
  assert.equal(percent(-1, 10), 0);
});

test('reliableCount берёт число сервера и не путает с леечем', () => {
  assert.equal(reliableCount({ totalWords: 10, long: 4, reliableCount: 3, leech: 9 }), 3);
  // Без поля (старый ответ) — по длинному бакету.
  assert.equal(reliableCount({ totalWords: 10, long: 4 }), 4);
  assert.equal(reliableCount(null), 0);
});

test('каждый бакет подписан по-русски и порядок фиксирован', () => {
  assert.deepEqual(
    SRS_BUCKETS.map((bucket) => bucket.id),
    ['learning', 'short', 'medium', 'long']
  );
  assert.deepEqual(
    SRS_BUCKETS.map((bucket) => bucket.label),
    ['< 1 дня', '1–7 дней', '8–30 дней', '> 30 дней']
  );
  assert.ok(SRS_BUCKETS.every((bucket) => bucket.caption.length > 0));
});

test('бакеты совпадают с формулой SM-2 из SrsService', () => {
  // Первый успешный ответ — 1 день — уже «1–7», а не «learning».
  // Второй — 6 дней, всё ещё «1–7». Третий — 6 × 2.5 = 15 — «8–30».
  let interval = 0;
  let ease = 2.5;
  let repetitions = 0;
  const buckets = [];

  for (const currentLapses of [0, 0, 0]) {
    void currentLapses;
    ease = Math.max(1.3, Math.min(3.0, ease + (0.1 - (5 - 4) * (0.08 + (5 - 4) * 0.02))));
    repetitions += 1;
    interval = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(Math.max(interval, 1) * ease);
    buckets.push({ interval, bucket: bucketOf(interval) });
  }

  assert.deepEqual(buckets, [
    { interval: 1, bucket: 'short' },
    { interval: 6, bucket: 'short' },
    { interval: 15, bucket: 'medium' },
  ]);
});

test('плюрализация совпадает с общей функцией приложения', () => {
  for (const n of [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111]) {
    assert.equal(pluralRu(n, ['слово', 'слова', 'слов']), plural(n, ['слово', 'слова', 'слов']));
  }
  assert.equal(wordsLabel(1), '1 слово');
  assert.equal(wordsLabel(3), '3 слова');
  assert.equal(wordsLabel(11), '11 слов');
});

test('formatNextInterval объясняет срок человеческим языком', () => {
  assert.equal(formatNextInterval(0, 10), 'через 10 минут');
  assert.equal(formatNextInterval(0), 'сегодня');
  assert.equal(formatNextInterval(1), 'завтра');
  assert.equal(formatNextInterval(5), 'через 5 дней');
  assert.equal(formatNextInterval(21), 'через 21 день');
});
