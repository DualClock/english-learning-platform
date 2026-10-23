import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PAGE_VIEW_EVENTS,
  PAGE_VIEW_SURFACES,
  createSingleShot,
  pageViewEvent,
} from './page-view.ts';

/*
 * Тесты верха воронки публичных витрин (W3.4).
 *
 * Проверяется не «запрос ушёл» (это делает бэкенд-тест), а ровно то, что живёт
 * в этой модуле и может тихо разъехаться: имя события по поверхности, пустой
 * результат на неизвестной поверхности, однократность отправки и то, что
 * клиентское зеркало совпадает с whitelist сервера. Плюс контракт из двух
 * полей: любое новое поле в теле = свободный текст в анонимной таблице.
 */

const SRC = resolve(import.meta.dirname, '..');
// src -> frontend -> корень репозитория: два подъёма, а не один. С одним
// путём он указывал на frontend/EnglishLearningPlatform.API, файла нет, и тест
// «клиентские имена не разъехались с whitelist сервера» молча пропускался.
const SERVER_CONTROLLER = resolve(SRC, '..', '..', 'EnglishLearningPlatform.API', 'Controllers', 'AnonymousAnalyticsController.cs');
const GUEST_ANALYTICS = resolve(SRC, 'app', 'lib', 'analytics.ts');
const PAGE_VIEW_COMPONENT = resolve(SRC, 'components', 'analytics', 'PageView.tsx');
const BETA_PAGE = resolve(SRC, 'app', 'beta', 'page.tsx');
const LIBRARY_PAGE = resolve(SRC, 'app', 'library', 'page.tsx');
const LIBRARY_BOOK_PAGE = resolve(SRC, 'app', 'library', '[slug]', 'page.tsx');

test('поверхности дают ровно своё имя события', () => {
  assert.equal(pageViewEvent('cohort'), 'cohort_page_viewed');
  assert.equal(pageViewEvent('library'), 'library_page_viewed');

  // Список поверхностей и список событий — один и тот же источник, иначе
  // добавленная поверхность осталась бы без имени, а значит без замера.
  assert.deepEqual([...PAGE_VIEW_SURFACES], ['cohort', 'library']);
  assert.deepEqual(
    [...PAGE_VIEW_EVENTS],
    PAGE_VIEW_SURFACES.map((surface) => pageViewEvent(surface)),
  );
});

test('неизвестная поверхность не отправляет ничего', () => {
  // Именно так и должен кончаться опечаточный пропс: null → «нет запроса»,
  // а не «новое имя события, которое сервер отклонит 400-м».
  for (const surface of ['', 'CoHOrT', 'cohort ', 'book', 'library/[slug]', 'slug', 'test']) {
    assert.equal(pageViewEvent(surface), null, `поверхность «${surface}»`);
  }
});

test('single-shot срабатывает ровно один раз и не делит состояние с соседом', () => {
  const shot = createSingleShot();
  assert.equal(shot(), true, 'первый вызов эффекта');
  assert.equal(shot(), false, 'двойной effect в StrictMode');
  assert.equal(shot(), false, 'перерисовка того же экземпляра');

  // Новый экземпляр = новый просмотр: иначе вторая вставка компонента на
  // другой странице молча осталась бы без счётчика.
  assert.equal(createSingleShot()(), true);
});

test('клиентские имена не разъехались с whitelist сервера', (t) => {
  if (!existsSync(SERVER_CONTROLLER)) {
    t.skip('API-проект не рядом с этой сборкой фронтенда');
    return;
  }

  const source = readFileSync(SERVER_CONTROLLER, 'utf8');

  // Оба имени объявлены константами и входят в AllowedEvents: сервер —
  // источник истины, а этот файл — его зеркало.
  for (const name of PAGE_VIEW_EVENTS) {
    assert.ok(source.includes(`"${name}"`), `сервер не знает событие ${name}`);
  }

  // Просмотры — ровно две страницы. Третья (например /library/[slug]) появилась
  // бы здесь как осознанная правка, а не как забытый в отчёте хвост.
  assert.deepEqual(
    [...source.matchAll(/"(\w+_page_viewed)"/g)].map((m) => m[1]).sort(),
    [...PAGE_VIEW_EVENTS].sort(),
  );
});

test('тело гостевого события остаётся двухпольным', (t) => {
  if (!existsSync(GUEST_ANALYTICS) || !existsSync(PAGE_VIEW_COMPONENT)) {
    t.skip('источники аналитики не рядом с этой сборкой фронтенда');
    return;
  }

  const analytics = readFileSync(GUEST_ANALYTICS, 'utf8');
  const component = readFileSync(PAGE_VIEW_COMPONENT, 'utf8');

  // Зеркало GUEST_EVENTS обязано содержать новые имена — иначе trackGuest не
  // примет их тип, и событие верха воронки не уйдёт вообще.
  for (const name of PAGE_VIEW_EVENTS) {
    assert.ok(analytics.includes(`'${name}'`), `GUEST_EVENTS не содержит ${name}`);
  }

  // Компонент отправляет только событие и ключ: ни slug, ни level, ни query.
  // Смотрим на сам вызов, а не на файл целиком, потому что в комментариях эти
  // слова упомянуты намеренно — там они объясняют, почему их нет в теле.
  const call = component.match(/trackGuest\(([^)]*)\)/);
  assert.ok(call, 'вызов trackGuest из PageView пропал');
  assert.match(call[1], /\bdedupeKey\b/);
  for (const forbidden of ['slug', 'query', 'search', 'referer', 'userAgent', 'level', 'meta']) {
    assert.ok(
      !call[1].includes(forbidden),
      `в теле гостевого просмотра появился запрещённый источник данных: ${forbidden}`,
    );
  }
});

test('счётчик подключён к /beta и /library, но не к страницам книг', (t) => {
  if (!existsSync(BETA_PAGE) || !existsSync(LIBRARY_PAGE)) {
    t.skip('страницы витрин не рядом с этой сборкой фронтенда');
    return;
  }

  assert.match(readFileSync(BETA_PAGE, 'utf8'), /<PageView surface="cohort" \/>/);
  assert.match(readFileSync(LIBRARY_PAGE, 'utf8'), /<PageView surface="library" \/>/);

  // Страницы книг намеренно без счётчика: 18 SSG-страниц под метрику, которую
  // сегодня нечем оптимизировать. Если решение изменится — правка видна в этом
  // тесте, а не в молча переехавшем коде.
  if (existsSync(LIBRARY_BOOK_PAGE)) {
    assert.doesNotMatch(readFileSync(LIBRARY_BOOK_PAGE, 'utf8'), /<PageView/);
  }

  // Ни одна из страниц не должна была стать клиентской целиком: серверный HTML
  // — это то, зачем страницы вообще серверные. Проверяется именно директива в
  // начале файла (комментарии внутри могут упоминать 'use client' сколько угодно).
  for (const [name, source] of [
    ['/beta', readFileSync(BETA_PAGE, 'utf8')],
    ['/library', readFileSync(LIBRARY_PAGE, 'utf8')],
  ]) {
    assert.ok(!/^\s*'use client'/m.test(source), `${name} переехал в клиентский рендер`);
  }
});
