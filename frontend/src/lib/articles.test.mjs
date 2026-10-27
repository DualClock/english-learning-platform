import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARTICLE_PAGE_SIZE,
  ARTICLE_STATUSES,
  articleFormInput,
  articlePublicPath,
  articleStatusTone,
  articlesAdminPath,
  articlesFeedPath,
  formatArticleDate,
  isValidArticleSlug,
  normalizeArticleStatus,
  slugFromTitle,
  statusLabel,
  textOrNull,
} from './articles.ts';
import { toProxyUrl } from '../app/lib/proxy-path.ts';

/*
 * Статьи: публичный раздел и админка.
 *
 * Тесты держат то, что ломается молча и всплывает только в браузере:
 *   - адрес ленты собирается так, что через прокси не выходит двойного
 *     `/api` (`/api/next/api/...` даёт 404 — этот баг уже ловили на книгах);
 *   - slug, набранный руками, не уносит в URL мусор и не превращается в
 *     пустую строку (тогда сервер генерирует свой, а админ думает, что задал
 *     свой);
 *   - статус из бэкенда приходит числом или строкой — если не перевести его в
 *     человеческое слово, админ видит «undefined» в таблице;
 *   - пустые поля формы уезжают как null, иначе «очистить анонс» не
 *     сработало бы: сервер считает `''` значением.
 */

test('адрес ленты статей: путь бэкенда без /api/next, через прокси — с ним', () => {
  assert.equal(articlesFeedPath({}), '/api/articles?page=1&pageSize=20');
  assert.equal(
    articlesFeedPath({ section: 'grammar', page: 2, pageSize: 10 }),
    '/api/articles?section=grammar&page=2&pageSize=10'
  );
  // Префикс /api/next дописывает toProxyUrl: второго /api быть не должно.
  assert.equal(toProxyUrl(articlesFeedPath({})), '/api/next/articles?page=1&pageSize=20');
});

test('раздел в адресе кодируется, пустой не уезжает', () => {
  assert.equal(articlesFeedPath({ section: '  ' }), '/api/articles?page=1&pageSize=20');
  assert.equal(
    articlesFeedPath({ section: 'phrasal-verbs' }),
    '/api/articles?section=phrasal-verbs&page=1&pageSize=20'
  );
  assert.match(articlesFeedPath({ section: 'a b' }), /section=a\+b/);
});

test('страница и размер не бывают нулевыми или дробными', () => {
  assert.equal(articlesFeedPath({ page: 0 }), '/api/articles?page=1&pageSize=20');
  assert.equal(articlesFeedPath({ page: -3 }), '/api/articles?page=1&pageSize=20');
  assert.equal(articlesFeedPath({ page: 2.7 }), '/api/articles?page=2&pageSize=20');
  assert.equal(articlesFeedPath({ pageSize: 0 }), `/api/articles?page=1&pageSize=${ARTICLE_PAGE_SIZE}`);
});

test('адрес админского списка: статус, поиск, страница', () => {
  assert.equal(articlesAdminPath({}), '/api/articles/admin?page=1&pageSize=20');
  assert.equal(
    articlesAdminPath({ status: 'draft', search: ' артикль ', page: 3 }),
    '/api/articles/admin?page=3&pageSize=20&status=draft&search=%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D0%BB%D1%8C'
  );
});

test('пустой фильтр не уезжает в адрес', () => {
  assert.equal(articlesAdminPath({ status: null, search: '   ' }), '/api/articles/admin?page=1&pageSize=20');
  assert.equal(
    articlesAdminPath({ status: 'published' }),
    '/api/articles/admin?page=1&pageSize=20&status=published'
  );
});

test('адрес публичной страницы статьи', () => {
  assert.equal(articlePublicPath('how-to-use-articles'), '/articles/how-to-use-articles');
  assert.equal(articlePublicPath('  howto  '), '/articles/howto');
  // Пустой slug не должен превращаться в ссылку на корень раздела.
  assert.equal(articlePublicPath(''), '');
  assert.equal(articlePublicPath(null), '');
  assert.equal(articlePublicPath(undefined), '');
  assert.equal(articlePublicPath('upper case'), '/articles/upper%20case');
});

test('валидный slug: только латиница в нижнем регистре, цифры и дефисы', () => {
  assert.equal(isValidArticleSlug('present-perfect'), true);
  assert.equal(isValidArticleSlug('a1-basics'), true);
  assert.equal(isValidArticleSlug('level-2'), true);
  assert.equal(isValidArticleSlug(''), false);
  assert.equal(isValidArticleSlug('Present Perfect'), false);
  assert.equal(isValidArticleSlug('статья'), false);
  assert.equal(isValidArticleSlug('-leading'), false);
  assert.equal(isValidArticleSlug('trailing-'), false);
  assert.equal(isValidArticleSlug('double--dash'), false);
});

test('slug из заголовка: латиница, цифры, дефисы; кириллица даёт пустую строку', () => {
  assert.equal(slugFromTitle('Present Perfect: how it works'), 'present-perfect-how-it-works');
  assert.equal(slugFromTitle('  A1 — Basics!  '), 'a1-basics');
  assert.equal(slugFromTitle('Как учить артикли'), '');
  assert.equal(slugFromTitle(''), '');
  assert.equal(slugFromTitle('!!!'), '');
  // Длина ограничена: без обрезки сервер отверг бы slug слишком длинным.
  const long = slugFromTitle('word '.repeat(80));
  assert.ok(long.length > 0 && long.length <= 80);
  assert.equal(long.endsWith('-'), false);
});

test('статус приходит числом и строкой — оба переводятся в одно слово', () => {
  assert.equal(normalizeArticleStatus('draft'), 'draft');
  assert.equal(normalizeArticleStatus('Draft'), 'draft');
  assert.equal(normalizeArticleStatus(0), 'draft');
  assert.equal(normalizeArticleStatus('published'), 'published');
  assert.equal(normalizeArticleStatus(1), 'published');
  assert.equal(normalizeArticleStatus('archived'), 'archived');
  assert.equal(normalizeArticleStatus(2), 'archived');
  assert.equal(normalizeArticleStatus(7), null);
  assert.equal(normalizeArticleStatus('что-то'), null);
  assert.equal(normalizeArticleStatus(null), null);
});

test('у статуса есть человеческое слово и тон плашки', () => {
  assert.equal(statusLabel('draft'), 'Черновик');
  assert.equal(statusLabel('published'), 'Опубликовано');
  assert.equal(statusLabel('archived'), 'Архив');
  assert.equal(statusLabel(null), 'Неизвестно');

  assert.equal(articleStatusTone('draft'), 'warning');
  assert.equal(articleStatusTone('published'), 'success');
  assert.equal(articleStatusTone('archived'), 'neutral');
  assert.equal(articleStatusTone(null), 'neutral');
  assert.deepEqual([...ARTICLE_STATUSES], ['draft', 'published', 'archived']);
});

test('тело формы: пустые поля становятся null, текст обрезается', () => {
  const input = articleFormInput({
    title: '  Артикли  ',
    slug: ' articles ',
    summary: '',
    sectionId: '',
    bodyMarkdown: '  # Заголовок\n\nТекст  ',
  });
  assert.deepEqual(input, {
    title: 'Артикли',
    slug: 'articles',
    summary: null,
    sectionId: null,
    bodyMarkdown: '# Заголовок\n\nТекст',
  });
});

test('sectionId невалиден — null, валидный — число', () => {
  assert.equal(articleFormInput({ title: 'T', sectionId: null }).sectionId, null);
  assert.equal(articleFormInput({ title: 'T', sectionId: undefined }).sectionId, null);
  assert.equal(articleFormInput({ title: 'T', sectionId: 3 }).sectionId, 3);
  assert.equal(articleFormInput({ title: 'T', sectionId: '5' }).sectionId, 5);
  assert.equal(articleFormInput({ title: 'T', sectionId: 'abc' }).sectionId, null);
  assert.equal(articleFormInput({ title: 'T', sectionId: 0 }).sectionId, null);
});

test('битый slug из формы не уезжает на сервер: сервер сгенерирует свой', () => {
  assert.equal(articleFormInput({ title: 'T', slug: 'Статья' }).slug, null);
  assert.equal(articleFormInput({ title: 'T', slug: 'ok-slug' }).slug, 'ok-slug');
  assert.equal(articleFormInput({ title: 'T' }).slug, null);
});

test('textOrNull: пустое по смыслу — null', () => {
  assert.equal(textOrNull('  x  '), 'x');
  assert.equal(textOrNull('   '), null);
  assert.equal(textOrNull(''), null);
  assert.equal(textOrNull(null), null);
  assert.equal(textOrNull(undefined), null);
});

test('дата статьи по-русски, без гидратационных расхождений', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  assert.equal(formatArticleDate('2026-10-05T10:00:00Z', now), '5 октября');
  assert.equal(formatArticleDate('2025-01-02T10:00:00Z', now), '2 января 2025');
  assert.equal(formatArticleDate(null, now), '');
  assert.equal(formatArticleDate('не дата', now), '');
});
