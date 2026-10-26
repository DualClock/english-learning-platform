import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROXY_PREFIX, toBackendPath, toProxyUrl } from '../app/lib/proxy-path.ts';

test('путь бэкенда уходит под префикс прокси', () => {
  assert.equal(toProxyUrl('/api/books'), '/api/next/books');
  assert.equal(PROXY_PREFIX, '/api/next');
});

test('query-строка сохраняется дословно', () => {
  assert.equal(toProxyUrl('/api/books?page=2&pageSize=100'), '/api/next/books?page=2&pageSize=100');
  assert.equal(toProxyUrl('/api/library?ref=stasya&utm_source=tg'), '/api/next/library?ref=stasya&utm_source=tg');
});

test('путь без префикса /api тоже проксируется', () => {
  assert.equal(toProxyUrl('/health'), '/api/next/health');
  assert.equal(toProxyUrl('books'), '/api/next/books');
});

test('повторный вызов не добавляет префикс дважды', () => {
  const once = toProxyUrl('/api/review/today');
  assert.equal(toProxyUrl(once), once);
  assert.equal(toProxyUrl('/api/next'), '/api/next');
});

test('абсолютный URL не проксируется', () => {
  assert.equal(toProxyUrl('https://example.com/x'), 'https://example.com/x');
});

test('пустой путь даёт корень прокси, а не его отсутствие', () => {
  assert.equal(toProxyUrl(''), '/api/next');
});

test('обратное преобразование симметрично прямому', () => {
  for (const path of ['/api/books', '/api/reader/books/7', '/api/progress/today-plan']) {
    assert.equal(toBackendPath(toProxyUrl(path)), path);
  }
});

test('обратное преобразование не трогает чужой путь', () => {
  assert.equal(toBackendPath('/page'), '/page');
});
