import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { articlesAdminPath, articlesFeedPath } from './articles.ts';
import { toProxyUrl } from '../app/lib/proxy-path.ts';

/*
 * Двойной `/api` в админском клиенте статей.
 *
 * Прокси строит цель как `${API_URL}/api/${path}`. Значит вызов
 * `fetch('/api/next/api/articles')` превращается в `/api/api/articles` → 404,
 * и кнопка «Опубликовать» молча не работает. Этот баг уже ловили на книгах
 * (см. api-next-paths.test.mjs) — здесь он проверяется для статей, потому что
 * у них два файла-сборщика адресов и легко забыть, где префикс.
 *
 * Тест читает исходники: проверяется форма пути в месте вызова, а не «сервер
 * ответил 404» — для последнего нужен живой бэкенд.
 */

const SRC = resolve(import.meta.dirname, '..');
const CLIENT = resolve(SRC, 'app', 'admin', 'content', 'articles', 'articles-api.ts');
const PUBLIC_PAGE = resolve(SRC, 'app', 'articles', 'page.tsx');

test('адреса статей не дают двойного /api при склейке с прокси', () => {
  for (const path of [
    articlesFeedPath({}),
    articlesFeedPath({ section: 'grammar', page: 2 }),
    articlesAdminPath({}),
    articlesAdminPath({ status: 'draft', search: 'a' }),
  ]) {
    const url = toProxyUrl(path);
    assert.ok(url.startsWith('/api/next/'), `адрес не идёт под прокси: ${url}`);
    assert.equal(url.includes('/api/next/api/'), false, `двойной /api: ${url}`);
  }
});

test('админский клиент статей не содержит второго /api в вызовах', () => {
  if (!existsSync(CLIENT)) {
    assert.fail('клиент админки статей не найден: ' + CLIENT);
  }
  const source = readFileSync(CLIENT, 'utf8');
  for (const line of source.split('\n')) {
    // Комментарии не в счёт: в шапке файла прокси упомянут намеренно, чтобы
    // объяснить, почему адреса собираются без префикса.
    if (/^\s*(\/\/|\/?\*)/.test(line)) continue;
    assert.equal(
      /['"`]\/api\/next\//.test(line),
      false,
      `в клиенте появился готовый адрес прокси, а его дописывает toProxyUrl: ${line.trim()}`
    );
  }
  // Каждый путь ручки начинается с /api/ — целых путей бэкенда здесь не бывает.
  for (const match of source.matchAll(/call(?:<[^>]*>)?\(\s*`?'?(\/[^`'"$]*)/g)) {
    assert.ok(
      match[1].startsWith('/api/'),
      `путь без /api: ${match[1]} — toProxyUrl превратит его в /api/next${match[1]}`
    );
  }
});

test('публичная страница статей не собирает адресов руками', () => {
  if (!existsSync(PUBLIC_PAGE)) {
    assert.fail('страница /articles не найдена: ' + PUBLIC_PAGE);
  }
  const source = readFileSync(PUBLIC_PAGE, 'utf8');
  assert.equal(
    /['"`]\/api\/next\//.test(source),
    false,
    'публичная страница должна брать данные через articles-feed.server.ts, а не fetch-ем'
  );
});
