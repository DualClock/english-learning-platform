import test from 'node:test';
import assert from 'node:assert/strict';

import { toProxyUrl } from '../app/lib/proxy-path.ts';
import {
  articleDraftRequest,
  normalizeAssistantError,
  normalizeAssistantStatus,
} from './assistant.ts';

/*
 * Адреса ручек ассистента через прокси.
 *
 * Проверяется текстом исходника, а не вызовом: функция делает fetch, а тянуть
 * сюда мок сети ради строки — лишний слой. Зато ловится конкретный баг, который
 * уже случался на книгах и статьях: `/api/next/api/admin/...` → 404.
 */

const source = await import('node:fs/promises').then((fs) =>
  fs.readFile(new URL('../app/admin/content/articles/assistant-api.ts', import.meta.url), 'utf8')
);

test('ручки ассистента собраны от пути бэкенда без второго /api', () => {
  for (const path of [
    '/api/admin/assistant/status',
    '/api/admin/assistant/article',
    '/api/admin/assistant/word-examples',
  ]) {
    assert.ok(source.includes(`'${path}'`), `в клиенте нет пути ${path}`);
  }
});

test('пути идут через toProxyUrl, а не склейкой строк', () => {
  assert.match(source, /toProxyUrl\(path\)/);
  assert.equal(source.includes('/api/next/admin'), false);
});

test('адрес ручки статьи после прокси', () => {
  const request = articleDraftRequest({ topic: 'Артикли', level: 'B1' });
  assert.ok(request);
  assert.deepEqual(request, { topic: 'Артикли', level: 'B1' });
  assert.equal(
    toProxyUrl('/api/admin/assistant/article'),
    '/api/next/admin/assistant/article'
  );
});

test('ошибки клиента {status,data} доходят до normalizeAssistantError', () => {
  const limit = normalizeAssistantError({ status: 429, data: { error: 'Лимит на сегодня' } });
  assert.equal(limit.kind, 'limit');
  assert.equal(limit.message, 'Лимит на сегодня');

  const off = normalizeAssistantError({ status: 503, data: { error: 'ИИ недоступен' } });
  assert.equal(off.kind, 'unavailable');
  assert.equal(off.message, 'ИИ недоступен');
});

test('статус из ответа сервера читается как остаток лимита', () => {
  const status = normalizeAssistantStatus({ limit: 20, used: 2, remaining: 18, enabled: true });
  assert.equal(status.remaining, 18);
  assert.equal(status.enabled, true);
});
