import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toAdminArticleDetail,
  toAdminArticleList,
  toArticleSectionOptions,
} from '../app/admin/content/articles/articles-api.ts';
import { normalizeArticleStatus, statusLabel } from './articles.ts';

/*
 * Разбор ответов админских ручек статей.
 *
 * Две ловушки, которые эти тесты держат:
 *
 *  1. Enum статуса. ASP.NET по умолчанию сериализует enum числом (0/1/2), а
 *     при `JsonStringEnumConverter` — строкой. Если клиент ждёт только строку,
 *     в таблице появляется «Неизвестно» для любой живой статьи, и админ не
 *     может нажать «Опубликовать» осмысленно.
 *  2. Битый элемент списка. Строка без id дала бы key={undefined} в React и
 *     строку «undefined» в таблице — вместо честного «элемент пропущен».
 */

test('список: строка с id и заголовком проходит, остальное отбрасывается', () => {
  const list = toAdminArticleList({
    items: [
      { id: 1, slug: 'a', title: 'Первая', status: 'draft' },
      { id: null, slug: 'b', title: 'Без id', status: 'draft' },
      { slug: 'c', title: '   ', status: 'draft' },
      'мусор',
      null,
    ],
    total: 42,
    page: 2,
    pageSize: 10,
  });

  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].title, 'Первая');
  assert.equal(list.total, 42);
  assert.equal(list.page, 2);
  assert.equal(list.pageSize, 10);
});

test('список: enum числом остаётся читаемым статусом', () => {
  const list = toAdminArticleList({
    items: [
      { id: 1, title: 'Черновик', status: 0 },
      { id: 2, title: 'Живая', status: 1 },
      { id: 3, title: 'В архиве', status: 2 },
    ],
  });

  assert.deepEqual(
    list.items.map((row) => statusLabel(row.status)),
    ['Черновик', 'Опубликовано', 'Архив']
  );
  assert.deepEqual(
    list.items.map((row) => normalizeArticleStatus(row.status)),
    ['draft', 'published', 'archived']
  );
});

test('список: пустой или битый ответ — пустой список, а не исключение', () => {
  for (const raw of [null, undefined, {}, { items: null }, { items: 'нет' }, 42]) {
    const list = toAdminArticleList(raw);
    assert.deepEqual(list.items, []);
    assert.equal(list.page, 1);
    assert.ok(list.pageSize >= 1);
  }
});

test('список: нет total — берём длину, страница не уходит в ноль', () => {
  const list = toAdminArticleList({ items: [{ id: 1, title: 'T' }], page: 0, pageSize: 0 });
  assert.equal(list.total, 1);
  assert.equal(list.page, 1);
  assert.equal(list.pageSize, 20);
});

test('черновик: bodyMarkdown читается, пустые поля — пустые строки', () => {
  const detail = toAdminArticleDetail({
    id: 7,
    slug: 'present-perfect',
    title: 'Present Perfect',
    summary: null,
    bodyMarkdown: '## Текст',
    status: 0,
    sectionId: null,
    publishedAt: null,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z',
    revisionCount: 3,
  });

  assert.ok(detail);
  assert.equal(detail.bodyMarkdown, '## Текст');
  assert.equal(detail.summary, null);
  assert.equal(detail.sectionId, null);
  assert.equal(detail.revisionCount, 3);
  assert.equal(statusLabel(detail.status), 'Черновик');
});

test('черновик: отсутствующие поля становятся пустыми строками', () => {
  const detail = toAdminArticleDetail({ id: 7, title: 'T', status: 'draft' });
  assert.ok(detail);
  assert.equal(detail.bodyMarkdown, '');
  assert.equal(detail.slug, '');
  assert.equal(detail.revisionCount, 0);
});

test('черновик без id или заголовка — null, а не форма с пустым заголовком', () => {
  assert.equal(toAdminArticleDetail({ title: 'T' }), null);
  assert.equal(toAdminArticleDetail({ id: 1, title: '  ' }), null);
  assert.equal(toAdminArticleDetail(null), null);
});

test('разделы для select: только с id и именем', () => {
  const options = toArticleSectionOptions({
    items: [
      { id: 1, name: 'Грамматика', slug: 'grammar', description: 'x', sortOrder: 1 },
      { id: null, name: 'Без id', slug: 'x' },
      { id: 2, name: '', slug: 'y' },
      { id: 3, name: 'Лексика' },
    ],
  });

  assert.deepEqual(options, [
    { id: 1, name: 'Грамматика', slug: 'grammar' },
    { id: 3, name: 'Лексика', slug: '' },
  ]);
  assert.deepEqual(toArticleSectionOptions(null), []);
});
