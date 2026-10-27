/*
 * Юнит-тесты in-memory кэша api-client: границы инвалидации и предел размера.
 *
 * Раньше кэш не был ограничен ничем: каждая страница на пути пользователя
 * добавляла записи, и в долгой сессии Map рос до сотен мегабайт — на телефоне
 * это заметно. Инвалидация искала подстроку (`key.includes`), поэтому
 * `invalidateCache('/api/book')` сносил и `/api/bookmarks`: после сохранения
 * закладки пропадал кэш совсем другого раздела.
 *
 * Тесты написаны на подставное хранилище `Map`: сам модуль держит настоящий
 * Map и сбрасывается функцией `__resetCacheForTests`, поэтому проверять
 * поведение можно без браузера и без сети.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  __resetCacheForTests,
  cacheKey,
  invalidateCache,
  MAX_CACHE_ENTRIES,
  peekCache,
  writeCache,
} from '../app/lib/api-client.ts';

test('ключ кэша больше не зависит от токена: его нет в JS', () => {
  // Сигнатура public-API: cacheKey(path). Второй аргумент игнорируется,
  // поэтому «свой» и «чужой» ответ не расходятся по разным записям —
  // скоуп даёт сервер, а не клиент.
  assert.equal(cacheKey('/api/books'), cacheKey('/api/books'));
  assert.equal(cacheKey('/api/books'), '/api/books');
  assert.equal(cacheKey('/api/books?page=2'), '/api/books?page=2');
});

test('инвалидация по префиксу не сносит соседний раздел', () => {
  __resetCacheForTests();
  writeCache('/api/books', ['books']);
  writeCache('/api/books?page=2', ['books-2']);
  writeCache('/api/bookmarks', ['bookmarks']);
  writeCache('/api/dictionary', ['dictionary']);

  invalidateCache('/api/books');

  assert.equal(peekCache('/api/books'), undefined);
  assert.equal(peekCache('/api/books?page=2'), undefined);
  // Главная проверка: подстрочное совпадение '/api/book' в '/api/bookmarks'
  // раньше стирало чужой кэш.
  assert.deepEqual(peekCache('/api/bookmarks'), ['bookmarks']);
  assert.deepEqual(peekCache('/api/dictionary'), ['dictionary']);
});

test('инвалидация по подстроке больше невозможна', () => {
  __resetCacheForTests();
  writeCache('/api/books', 1);
  writeCache('/api/my-api/books', 2);

  // '/api/books' встречается в середине второго ключа, но ключ начинается
  // с '/api/my', поэтому запись обязана остаться.
  invalidateCache('/api/books');
  assert.equal(peekCache('/api/books'), undefined);
  assert.equal(peekCache('/api/my-api/books'), 2);
});

test('пустой префикс очищает кэш целиком', () => {
  __resetCacheForTests();
  writeCache('/api/a', 1);
  writeCache('/api/b', 2);

  invalidateCache();
  assert.equal(peekCache('/api/a'), undefined);
  assert.equal(peekCache('/api/b'), undefined);
});

test('кэш ограничен и вытесняет самую старую запись', () => {
  __resetCacheForTests();
  assert.equal(MAX_CACHE_ENTRIES, 100);

  for (let i = 0; i < MAX_CACHE_ENTRIES; i += 1) {
    writeCache(`/api/page-${i}`, i);
  }
  assert.equal(peekCache('/api/page-0'), 0, 'до переполнения ничего не вытесняется');

  writeCache('/api/overflow', 'new');

  assert.equal(peekCache('/api/overflow'), 'new');
  assert.equal(peekCache('/api/page-0'), undefined, 'вытеснена самая старая запись');
  assert.equal(peekCache('/api/page-1'), 1, 'остальные на месте');
  assert.equal(peekCache(`/api/page-${MAX_CACHE_ENTRIES - 1}`), MAX_CACHE_ENTRIES - 1);
});

test('предел соблюдается и в долгой сессии', () => {
  __resetCacheForTests();
  for (let i = 0; i < MAX_CACHE_ENTRIES * 3; i += 1) {
    writeCache(`/api/route-${i}`, i);
  }

  let alive = 0;
  for (let i = 0; i < MAX_CACHE_ENTRIES * 3; i += 1) {
    if (peekCache(`/api/route-${i}`) !== undefined) alive += 1;
  }
  assert.equal(alive, MAX_CACHE_ENTRIES, 'в кэше не больше MAX_CACHE_ENTRIES записей');
  // Живыми остаются последние записи — вытесняется самый старый `at`.
  assert.equal(peekCache(`/api/route-${MAX_CACHE_ENTRIES * 3 - 1}`), MAX_CACHE_ENTRIES * 3 - 1);
  assert.equal(peekCache('/api/route-0'), undefined);
});

test('повторная запись по тому же ключу не занимает второе место', () => {
  __resetCacheForTests();
  for (let i = 0; i < MAX_CACHE_ENTRIES; i += 1) {
    writeCache(`/api/item-${i}`, i);
  }
  writeCache('/api/item-0', 'updated');

  assert.equal(peekCache('/api/item-0'), 'updated');
  // Ни одна запись не вытеснена: ключ уже был в кэше.
  for (let i = 0; i < MAX_CACHE_ENTRIES; i += 1) {
    assert.notEqual(peekCache(`/api/item-${i}`), undefined, `потеряна запись item-${i}`);
  }
});
