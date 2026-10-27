import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTERESTS,
  interestLabel,
  interestsButtonLabel,
  interestsPayload,
  isInterestKey,
  normalizeInterests,
  toggleInterest,
} from './interests.ts';

/*
 * Справочник интересов — контракт с базой: ключ пишется в `UserInterest`,
 * ключом же фильтруются новости. Поэтому тесты держат не «красоту списка»,
 * а три свойства, которые ломаются молча:
 *   1. набор ключей совпадает с тем, что лежит в таблице тем;
 *   2. всё постороннее отбрасывается до отправки (иначе 400 на весь список);
 *   3. подпись есть у каждого ключа — иначе на шаге онбординга пустая плашка.
 */

test('ключи интересов совпадают со справочником в базе', () => {
  assert.deepEqual(
    INTERESTS.map((item) => item.key),
    [
      'news', 'sport', 'science', 'tech', 'business',
      'culture', 'travel', 'health', 'nature', 'interesting',
    ]
  );
});

test('у каждого интереса есть русская подпись', () => {
  for (const item of INTERESTS) {
    assert.ok(item.label.trim().length > 0, `нет подписи для ${item.key}`);
    // Подпись не должна совпадать с ключом: латиница в интерфейсе — утечка.
    assert.notEqual(item.label, item.key);
  }
  assert.equal(interestLabel('sport'), 'Спорт');
  assert.equal(interestLabel('tech'), 'Технологии');
});

test('неизвестный ключ не проходит проверку и отдаётся как есть в подписи', () => {
  assert.equal(isInterestKey('sport'), true);
  assert.equal(isInterestKey(' Sport '), true);
  assert.equal(isInterestKey('sports'), false);
  assert.equal(isInterestKey(''), false);
  assert.equal(isInterestKey(null), false);
  assert.equal(isInterestKey(42), false);
  assert.equal(interestLabel('sports'), 'sports');
});

test('мусор и повторы схлопываются, порядок — как в справочнике', () => {
  assert.deepEqual(normalizeInterests(['tech', 'sport', 'tech', 'sports', '  SCIENCE ']), [
    'sport',
    'science',
    'tech',
  ]);
  assert.deepEqual(normalizeInterests([]), []);
  assert.deepEqual(normalizeInterests(null), []);
  assert.deepEqual(normalizeInterests(undefined), []);
  assert.deepEqual(normalizeInterests(['nope', '']), []);
});

test('переключатель добавляет и снимает тему, сохраняя порядок справочника', () => {
  const one = toggleInterest([], 'tech');
  assert.deepEqual(one, ['tech']);

  const two = toggleInterest(one, 'sport');
  // sport идёт раньше tech в справочнике, значит оказывается первым.
  assert.deepEqual(two, ['sport', 'tech']);

  assert.deepEqual(toggleInterest(two, 'tech'), ['sport']);
  assert.deepEqual(toggleInterest(['sport'], 'sport'), []);
  // Мусорный ключ не добавляется и не ломает текущий выбор.
  assert.deepEqual(toggleInterest(['sport'], 'sports'), ['sport']);
});

test('тело запроса на сохранение интересов — ровно {"interests": [...]}', () => {
  assert.deepEqual(interestsPayload(['sport', 'tech']), { interests: ['sport', 'tech'] });
  assert.deepEqual(interestsPayload(['tech', 'tech']), { interests: ['tech'] });
  assert.deepEqual(interestsPayload([]), { interests: [] });
  // Ключ контракта именно `interests`: сервер читает его как массив строк.
  assert.deepEqual(Object.keys(interestsPayload([])), ['interests']);
});

test('подпись кнопки не обещает «0 тем» при пустом выборе', () => {
  assert.equal(interestsButtonLabel([]), 'Пропустить');
  assert.equal(interestsButtonLabel(['sport']), 'Выбрать 1 тему');
  assert.equal(interestsButtonLabel(['sport', 'tech']), 'Выбрать 2 темы');
  assert.equal(interestsButtonLabel(['news', 'sport', 'science', 'tech', 'business']), 'Выбрать 5 тем');
});
