import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_NEWS,
  formatNewsDate,
  isSafeSourceUrl,
  matchesInterests,
  newsFeedPath,
  newsTopics,
  normalizeNewsLevel,
  selectNews,
  shouldShowNews,
  sourceHost,
  toNewsList,
} from './news.ts';

/*
 * Блок «Новости для тебя» на дашборде. Тесты держат четыре правила, каждое
 * из которых видно глазами только у одного пользователя из десяти:
 *   - фильтр по интересам (пустой набор — показать всё, чужая тема — скрыть);
 *   - не больше пяти карточек;
 *   - уровень валиден, иначе бейдж рисуется пустым;
 *   - пустой список — блока нет вовсе, а не «пока ничего нет».
 */

function news(overrides = {}) {
  return {
    id: 1,
    title: 'Заголовок',
    summary: 'Краткое описание',
    bodyHtml: null,
    sourceName: 'BBC',
    sourceUrl: 'https://www.bbc.com/news/articles/1',
    imageUrl: null,
    level: 'B1',
    topics: 'news',
    publishedAt: '2026-10-20T10:00:00Z',
    isHidden: false,
    ...overrides,
  };
}

test('предел блока — пять карточек', () => {
  assert.equal(MAX_NEWS, 5);
  const many = Array.from({ length: 12 }, (_, i) =>
    news({ id: i + 1, publishedAt: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z` })
  );
  assert.equal(selectNews(many, []).length, MAX_NEWS);
});

test('фильтр по интересам: берём только выбранные темы', () => {
  const items = [
    news({ id: 1, topics: 'sport' }),
    news({ id: 2, topics: 'tech' }),
    news({ id: 3, topics: 'business' }),
  ];
  assert.deepEqual(selectNews(items, ['sport']).map((n) => n.id), [1]);
  assert.deepEqual(selectNews(items, ['sport', 'business']).map((n) => n.id), [3, 1].sort((a, b) => a - b));
});

test('темы новости читаются из строки через запятую, без пробелов по краям', () => {
  assert.deepEqual(newsTopics(news({ topics: 'sport, tech' })), ['sport', 'tech']);
  assert.deepEqual(newsTopics(news({ topics: 'Sport;TECH' })), ['sport', 'tech']);
  assert.deepEqual(newsTopics(news({ topics: 'sport|science' })), ['sport', 'science']);

  // API отдаёт topics МАССИВОМ (контроллер режет строку на выходе), хотя в
  // базе они лежат строкой. Разбор только строки ронял дашборд целиком:
  // «item.topics.split is not a function» уводил страницу в error boundary.
  assert.deepEqual(newsTopics(news({ topics: ['sport', 'tech'] })), ['sport', 'tech']);
  assert.deepEqual(newsTopics(news({ topics: [] })), []);
  assert.deepEqual(newsTopics(news({ topics: ['sport, tech'] })), ['sport', 'tech']);
  assert.deepEqual(newsTopics(news({ topics: '' })), []);
  assert.deepEqual(newsTopics(news({ topics: null })), []);
});

test('новость с несколькими темами находится по любой из них', () => {
  const item = news({ topics: 'science, tech' });
  assert.equal(matchesInterests(item, ['tech']), true);
  assert.equal(matchesInterests(item, ['science']), true);
  assert.equal(matchesInterests(item, ['sport']), false);
});

test('пустой набор интересов показывает всё, но не ломает фильтр по скрытым', () => {
  const items = [
    news({ id: 1, topics: 'sport' }),
    news({ id: 2, topics: 'tech', isHidden: true }),
  ];
  assert.deepEqual(selectNews(items, []).map((n) => n.id), [1]);
  assert.deepEqual(selectNews(items, ['sport', 'tech']).map((n) => n.id), [1]);
});

test('скрытая новость не показывается ни при каком выборе', () => {
  const hidden = news({ topics: 'sport', isHidden: true });
  assert.equal(matchesInterests(hidden, ['sport']), true);
  // matchesInterests отвечает только за тему; скрытие — дело selectNews.
  assert.deepEqual(selectNews([hidden], ['sport']), []);
});

test('уровень валиден только из набора A1/A2/B1/B2/C1', () => {
  assert.equal(normalizeNewsLevel('A1'), 'A1');
  assert.equal(normalizeNewsLevel('c1'), 'C1');
  assert.equal(normalizeNewsLevel(' b2 '), 'B2');
  assert.equal(normalizeNewsLevel('C2'), null);
  assert.equal(normalizeNewsLevel('B3'), null);
  assert.equal(normalizeNewsLevel(''), null);
  assert.equal(normalizeNewsLevel(null), null);
  assert.equal(normalizeNewsLevel(42), null);
});

test('новость с невалидным уровнем не попадает в блок', () => {
  const items = [
    news({ id: 1, level: 'B1' }),
    news({ id: 2, level: 'C2' }),
    news({ id: 3, level: 'zz' }),
    news({ id: 4, level: null }),
  ];
  assert.deepEqual(selectNews(items, []).map((n) => n.id), [1]);
});

test('свежие новости выше, мусорная дата — в конец', () => {
  const items = [
    news({ id: 1, publishedAt: '2026-10-01T10:00:00Z' }),
    news({ id: 2, publishedAt: 'не дата' }),
    news({ id: 3, publishedAt: '2026-10-25T10:00:00Z' }),
  ];
  assert.deepEqual(selectNews(items, []).map((n) => n.id), [3, 1, 2]);
});

test('пустой список — блока нет, должен вернуться false', () => {
  assert.equal(shouldShowNews([]), false);
  assert.equal(shouldShowNews(selectNews([], [])), false);

  // Раньше здесь утверждалось, что «всё отфильтровалось интересами — блока
  // тоже нет». Это поведение и оказалось дефектом: у источника нет нужных
  // рубрик, и человек, выбравший «Спорт», видел пустоту при живых новостях.
  // Теперь промах по интересам даёт свежий микс — блок показывается.
  const onlySport = [news({ topics: 'sport' })];
  assert.equal(shouldShowNews(selectNews(onlySport, ['tech'])), true);
});

test('непустой список — блок показывается', () => {
  assert.equal(shouldShowNews([news()]), true);
});

test('ответ-конверт { items } и массив читаются одинаково', () => {
  const item = news();
  assert.deepEqual(toNewsList([item]).map((n) => n.id), [1]);
  assert.deepEqual(toNewsList({ items: [item] }).map((n) => n.id), [1]);
  assert.deepEqual(toNewsList(null), []);
  assert.deepEqual(toNewsList(undefined), []);
  assert.deepEqual(toNewsList({}), []);
  assert.equal(selectNews({ items: [item] }, []).length, 1);
});

test('новость без заголовка не тратит место в пятёрке', () => {
  const items = [news({ id: 1, title: '   ' }), news({ id: 2, title: 'Есть заголовок' })];
  assert.deepEqual(selectNews(items, []).map((n) => n.id), [2]);
});

test('источник и дата: хост без www, дата по-русски', () => {
  assert.equal(sourceHost('https://www.bbc.com/news/1'), 'bbc.com');
  assert.equal(sourceHost('https://lenta.ru/a'), 'lenta.ru');
  assert.equal(sourceHost('не url'), '');

  const now = new Date('2026-10-27T12:00:00Z');
  assert.equal(formatNewsDate('2026-10-05T10:00:00Z', now), '5 октября');
  assert.equal(formatNewsDate('2025-01-02T10:00:00Z', now), '2 января 2025');
  assert.equal(formatNewsDate('не дата', now), '');
});

test('ссылка на первоисточник — только http(s)', () => {
  assert.equal(isSafeSourceUrl('https://example.com/a'), true);
  assert.equal(isSafeSourceUrl('http://example.com'), true);
  assert.equal(isSafeSourceUrl('javascript:alert(1)'), false);
  assert.equal(isSafeSourceUrl('data:text/html,x'), false);
  assert.equal(isSafeSourceUrl(''), false);
  assert.equal(isSafeSourceUrl(null), false);
});

test('адрес ленты: уровень и предел пятёрки, без интересов', () => {
  // Интересы сервер берёт из профиля сам: если бы клиент передавал их в
  // адресе, любой мог бы запросить подборку по чужим темам.
  assert.equal(newsFeedPath(null), '/api/next/news/for-me?take=5');
  assert.equal(newsFeedPath('a1'), '/api/next/news/for-me?take=5&level=A1');
  assert.equal(newsFeedPath('B1'), '/api/next/news/for-me?take=5&level=B1');

  // Невалидный уровень не уезжает в адрес — сервер вернул бы смесь уровней
  // под видом точного фильтра.
  assert.equal(newsFeedPath('Z9'), '/api/next/news/for-me?take=5');
  assert.equal(newsFeedPath(''), '/api/next/news/for-me?take=5');
  assert.equal(newsFeedPath(undefined), '/api/next/news/for-me?take=5');
});

test('по интересам пусто — показываем свежий микс, а не пустой блок', () => {
  // Реальный случай: источник (News in Levels) не размечает рубрики, у всех
  // новостей тема «news». Человек, выбравший «Спорт» и «Технологии», видел
  // пустой блок — при том что новости есть.
  const items = [
    news({ id: 1, topics: 'news', publishedAt: '2026-10-27T10:00:00Z' }),
    news({ id: 2, topics: 'interesting', publishedAt: '2026-10-27T11:00:00Z' }),
  ];

  const picked = selectNews(items, ['sport', 'tech']);

  assert.deepEqual(picked.map((n) => n.id).sort((a, b) => a - b), [1, 2]);
});

test('совпадение по теме важнее свежести', () => {
  // Fallback не должен размывать персонализацию: если хоть что-то совпало,
  // показываем ТОЛЬКО совпавшее, даже если остальное свежее.
  const items = [
    news({ id: 1, topics: 'sport', publishedAt: '2026-10-20T10:00:00Z' }),
    news({ id: 2, topics: 'news', publishedAt: '2026-10-27T10:00:00Z' }),
  ];

  const picked = selectNews(items, ['sport']);

  assert.deepEqual(picked.map((n) => n.id), [1]);
});

test('пустой набор интересов не считается «не нашлось совпадений»', () => {
  // Различие важно: человек, пропустивший шаг интересов, должен видеть всё —
  // это не fallback, а нормальное поведение. Смешать их значит потерять
  // возможность отличить «не выбрал» от «выбрал, но не совпало».
  const items = [news({ id: 1, topics: 'news' }), news({ id: 2, topics: 'sport' })];

  assert.equal(selectNews(items, []).length, 2);
});
