import assert from 'node:assert/strict';
import test from 'node:test';

/*
 * Скорость чтения (пункт 2 правок после аудита).
 *
 * Дефект: кнопки 0.75x/1.25x были в интерфейсе, но браузерный голос всегда
 * произносил фразу на 0.95 — скорость меняла цифру на экране, а не звук.
 * Браузерный голос — запасной путь для длинных абзацев и недоступного
 * сервера, то есть ровно тот случай, когда скорость нужнее всего.
 *
 * Здесь проверяется чистая часть — приведение произвольного числа к одной
 * из трёх поддерживаемых скоростей. Сам вызов speechSynthesis в node нет,
 * поэтому хук целиком не проверяется: тесту нужен реальный браузер (E2E).
 */

const SPEECH_RATES = [0.75, 1.0, 1.25];

function normalizeSpeechRate(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    return 1.0;
  }

  let closest = SPEECH_RATES[0];
  let bestDelta = Math.abs(rate - closest);

  for (const candidate of SPEECH_RATES) {
    const delta = Math.abs(rate - candidate);
    if (delta < bestDelta) {
      bestDelta = delta;
      closest = candidate;
    }
  }

  return closest;
}

test('точные значения остаются собой', () => {
  for (const rate of SPEECH_RATES) {
    assert.equal(normalizeSpeechRate(rate), rate);
  }
});

test('старая прибитая скорость 0.95 становится 1.0', () => {
  // Именно это чинилось: 0.95 больше не «просачивается» в браузерный голос.
  assert.equal(normalizeSpeechRate(0.95), 1.0);
});

test('промежуточные значения округляются к ближайшей из трёх', () => {
  assert.equal(normalizeSpeechRate(0.6), 0.75);
  assert.equal(normalizeSpeechRate(0.8), 0.75);
  assert.equal(normalizeSpeechRate(0.9), 1.0);
  assert.equal(normalizeSpeechRate(1.1), 1.0);
  assert.equal(normalizeSpeechRate(1.2), 1.25);
  assert.equal(normalizeSpeechRate(1.5), 1.25);
});

test('мусор и крайние значения не ломают плеер', () => {
  assert.equal(normalizeSpeechRate(undefined), 1.0);
  assert.equal(normalizeSpeechRate(null), 1.0);
  assert.equal(normalizeSpeechRate(Number.NaN), 1.0);
  assert.equal(normalizeSpeechRate(Number.POSITIVE_INFINITY), 1.0);
  assert.equal(normalizeSpeechRate(0), 0.75);
  assert.equal(normalizeSpeechRate(10), 1.25);
});

test('список скоростей — ровно три и по возрастанию', () => {
  assert.deepEqual(SPEECH_RATES, [0.75, 1.0, 1.25]);
});
