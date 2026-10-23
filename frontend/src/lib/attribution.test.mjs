import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTRIBUTION_COOKIE_NAME,
  MAX_CODE_LENGTH,
  capture,
  deserialize,
  getActiveAttribution,
  isExpired,
  normalizeCode,
  parseAttributionParams,
  readCookie,
  readStored,
  registrationPayload,
  resolveAttribution,
  serialize,
} from './attribution.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-23T12:00:00Z');

/** Мини-хранилище вместо sessionStorage: тест не должен зависеть от браузера. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
  };
}

function cookieJar(initial = '') {
  let value = initial;
  return {
    get string() {
      return value;
    },
    write: (_name, encoded, maxAgeSeconds) => {
      value = `${ATTRIBUTION_COOKIE_NAME}=${encoded}; Max-Age=${maxAgeSeconds}`;
    },
  };
}

test('нормализация: нижний регистр, только [a-z0-9-], дефис вместо мусора', () => {
  assert.equal(normalizeCode('VK-Group'), 'vk-group');
  assert.equal(normalizeCode('  Stasya '), 'stasya');
  assert.equal(normalizeCode('books_tg_2026'), 'books-tg-2026');
  assert.equal(normalizeCode('Zen/Post 42'), 'zen-post-42');
  assert.equal(normalizeCode('--a--b--'), 'a-b');
});

test('нормализация: всё, что не латиница, превращается в null', () => {
  assert.equal(normalizeCode(null), null);
  assert.equal(normalizeCode(''), null);
  assert.equal(normalizeCode('   '), null);
  assert.equal(normalizeCode('привет'), null);
  assert.equal(normalizeCode('🚀'), null);
  assert.equal(normalizeCode('///'), null);
});

test('нормализация: длина ограничена колонкой БД, хвостовой дефис не остаётся', () => {
  assert.equal(normalizeCode('a'.repeat(500)).length, MAX_CODE_LENGTH);

  // 63 символа + разделитель ровно на границе: обрезать надо так, чтобы
  // дефис не остался частью кода
  const cut = normalizeCode(`${'a'.repeat(MAX_CODE_LENGTH - 1)}-${'b'.repeat(10)}`);
  assert.ok(cut.length <= MAX_CODE_LENGTH);
  assert.ok(!cut.endsWith('-'), 'обрезка не должна оставлять дефис на конце');

  const midCut = normalizeCode(`${'a'.repeat(60)}-${'b'.repeat(20)}`);
  assert.equal(midCut.length, MAX_CODE_LENGTH);
  assert.ok(!midCut.endsWith('-'));
});

test('из query берутся ref и все три utm-метки', () => {
  assert.deepEqual(
    parseAttributionParams('?ref=Stasya&utm_source=vk&utm_medium=social&utm_content=post-7'),
    { ref: 'Stasya', utmSource: 'vk', utmMedium: 'social', utmContent: 'post-7' }
  );
  assert.deepEqual(parseAttributionParams(''), {
    ref: null,
    utmSource: null,
    utmMedium: null,
    utmContent: null,
  });
});

test('ref приоритетнее utm_source: источник берётся из личной ссылки', () => {
  const record = resolveAttribution(
    null,
    parseAttributionParams('?ref=Stasya&utm_source=vk'),
    NOW
  );

  assert.equal(record.ref, 'stasya');
  assert.equal(record.utmSource, 'vk');
});

test('ссылка без латиницы не превращается в запись', () => {
  assert.equal(resolveAttribution(null, parseAttributionParams('?ref=привет'), NOW), null);
});

test('first touch: сохранённая запись не заменяется новой ссылкой', () => {
  const stored = { ref: 'stasya', utmSource: null, utmMedium: null, utmContent: null, capturedAt: NOW - 5 * DAY };

  const result = resolveAttribution(stored, parseAttributionParams('?ref=other-channel'), NOW);

  assert.equal(result, stored);
  assert.equal(result.ref, 'stasya');
});

test('окно атрибуции 30 дней: истёкшая запись отдаётся новому каналу', () => {
  const stale = { ref: 'old', utmSource: null, utmMedium: null, utmContent: null, capturedAt: NOW - 31 * DAY };
  assert.ok(isExpired(stale, NOW));

  const result = resolveAttribution(stale, parseAttributionParams('?ref=new'), NOW);

  assert.equal(result.ref, 'new');
  assert.equal(result.capturedAt, NOW);
});

test('срок годности ровно 30 дней ещё не истёк', () => {
  assert.ok(!isExpired({ ref: 'a', utmSource: null, utmMedium: null, utmContent: null, capturedAt: NOW - 29 * DAY }, NOW));
});

test('сериализация туда и обратно', () => {
  const record = { ref: 'stasya', utmSource: 'vk', utmMedium: null, utmContent: 'post-7', capturedAt: NOW };

  assert.deepEqual(deserialize(serialize(record)), record);
});

test('битое хранимое значение читается как «нет атрибуции»', () => {
  assert.equal(deserialize(null), null);
  assert.equal(deserialize(''), null);
  assert.equal(deserialize('только-одно-поле'), null);
  assert.equal(deserialize('a|b|c|d|не-число'), null);
});

test('cookie имеет приоритет над sessionStorage', () => {
  const inCookie = serialize({ ref: 'from-cookie', utmSource: null, utmMedium: null, utmContent: null, capturedAt: NOW });
  const inStorage = serialize({ ref: 'from-storage', utmSource: null, utmMedium: null, utmContent: null, capturedAt: NOW });

  const storage = memoryStorage({ lex_attr: inStorage });
  const result = readStored(`${ATTRIBUTION_COOKIE_NAME}=${inCookie}`, storage);

  assert.equal(result.ref, 'from-cookie');
});

test('capture пишет cookie с TTL 30 дней и зеркалит в sessionStorage', () => {
  const cookie = cookieJar();
  const storage = memoryStorage();
  const maxAgeSeconds = 30 * 24 * 60 * 60;

  const record = capture('?ref=Stasya&utm_source=vk', cookie.string, storage, NOW, 30, cookie.write);

  assert.equal(record.ref, 'stasya');
  assert.match(cookie.string, new RegExp(`Max-Age=${maxAgeSeconds}`));
  assert.deepEqual(deserialize(decodeURIComponent(cookie.string.split(';')[0].split('=')[1])), record);
  assert.equal(storage.getItem('lex_attr'), serialize(record));
});

test('capture не перетирает уже сохранённый канал', () => {
  const saved = { ref: 'stasya', utmSource: null, utmMedium: null, utmContent: null, capturedAt: NOW - DAY };
  const cookie = cookieJar(`${ATTRIBUTION_COOKIE_NAME}=${serialize(saved)}`);
  const storage = memoryStorage();

  const record = capture('?ref=habr', cookie.string, storage, NOW, 30, cookie.write);

  assert.equal(record.ref, 'stasya');
});

test('capture на странице без меток и без сохранённого канала ничего не пишет', () => {
  const cookie = cookieJar();
  const storage = memoryStorage();

  assert.equal(capture('/books', cookie.string, storage, NOW, 30, cookie.write), null);
  assert.equal(cookie.string, '');
  assert.equal(storage.getItem('lex_attr'), null);
});

test('регистрация не отправляет канал, если окну атрибуции больше 30 дней', () => {
  const fresh = serialize({ ref: 'stasya', utmSource: null, utmMedium: null, utmContent: null, capturedAt: NOW - DAY });
  const stale = serialize({ ref: 'stasya', utmSource: null, utmMedium: null, utmContent: null, capturedAt: NOW - 45 * DAY });

  assert.deepEqual(registrationPayload(getActiveAttribution(`${ATTRIBUTION_COOKIE_NAME}=${fresh}`, null, NOW)), {
    ref: 'stasya',
  });
  assert.equal(getActiveAttribution(`${ATTRIBUTION_COOKIE_NAME}=${stale}`, null, NOW), null);
  assert.deepEqual(registrationPayload(getActiveAttribution(`${ATTRIBUTION_COOKIE_NAME}=${stale}`, null, NOW)), {});
});

test('в тело регистрации уходят только непустые метки', () => {
  assert.deepEqual(
    registrationPayload({ ref: 'stasya', utmSource: null, utmMedium: 'social', utmContent: null, capturedAt: NOW }),
    { ref: 'stasya', utmMedium: 'social' }
  );
  assert.deepEqual(registrationPayload(null), {});
});

test('cookie парсится из document.cookie с несколькими паролями', () => {
  const jar = `_ga=ABC; ${ATTRIBUTION_COOKIE_NAME}=stasya%7C%7C%7C%7C1700000000000; theme=dark`;

  assert.equal(readCookie(ATTRIBUTION_COOKIE_NAME, jar), 'stasya||||1700000000000');
  assert.equal(readStored(jar, null).capturedAt, 1700000000000);
});
