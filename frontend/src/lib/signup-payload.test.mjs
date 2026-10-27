import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRegistrationPayload, honeypotInputProps, HONEYPOT_WRAPPER_STYLE } from './signup-payload.ts';

/**
 * Контракт тела POST /api/auth/register (W1.4.4).
 *
 * Серверный honeypot из 1b1c8c9 принимал `RegisterDto.Website` и отбивал
 * заполненное поле — а фронтенд это поле никогда не отправлял. Проверить такое
 * можно только одним способом: зафиксировать, что ключ `website` присутствует в
 * payload всегда, а не «когда захотим».
 *
 * Тест держит и имена остальных ключей: MVC связывает JSON без учёта регистра,
 * поэтому опечатка в имени не даёт ошибку — поле просто перестаёт доезжать.
 */

const base = {
  name: 'Анна',
  email: 'anna@example.com',
  password: 'Password1',
  level: 'b1',
  goals: ['books', 'work'],
  minutes: 20,
  notifications: true,
  timezone: 'Europe/Berlin',
  website: '',
};

/** Имена полей серверного RegisterDto (AuthController.cs) — зеркало контракта. */
const REGISTER_DTO_KEYS = [
  'email',
  'password',
  'displayName',
  'cefrLevel',
  'studyGoal',
  'dailyGoalMinutes',
  'timeZoneId',
  'notifyEnabled',
  'website',
  'utmSource',
  'utmMedium',
  'utmContent',
  'ref',
];

test('honeypot-поле уходит на сервер всегда, даже пустым', () => {
  const payload = buildRegistrationPayload(base, null);

  assert.ok(
    Object.prototype.hasOwnProperty.call(payload, 'website'),
    'в теле регистрации нет поля website — серверный honeypot не получает ничего и не работает'
  );
  assert.equal(payload.website, '');
});

test('заполненное honeypot-поле передаётся как есть, бот не «исправляется» на фронте', () => {
  const payload = buildRegistrationPayload({ ...base, website: 'https://spam.example' }, null);

  assert.equal(payload.website, 'https://spam.example');
});

test('имена ключей payload совпадают с RegisterDto', () => {
  const payload = buildRegistrationPayload(base, {
    ref: 'stasya',
    utmSource: 'vk',
    utmMedium: 'social',
    utmContent: 'post-7',
  });

  const unknown = Object.keys(payload).filter((key) => !REGISTER_DTO_KEYS.includes(key));
  assert.deepEqual(unknown, [], `фронтенд отправляет поля, которых нет в RegisterDto: ${unknown.join(', ')}`);

  for (const key of ['email', 'password', 'displayName', 'cefrLevel', 'studyGoal', 'dailyGoalMinutes', 'timeZoneId', 'notifyEnabled', 'website']) {
    assert.ok(Object.prototype.hasOwnProperty.call(payload, key), `нет обязательного поля ${key}`);
  }
});

test('значение полей регистрации собирается как раньше: goals списком, level строкой', () => {
  const payload = buildRegistrationPayload(base, null);

  assert.equal(payload.email, 'anna@example.com');
  assert.equal(payload.password, 'Password1');
  assert.equal(payload.displayName, 'Анна');
  assert.equal(payload.cefrLevel, 'b1');
  assert.equal(payload.studyGoal, 'books,work');
  assert.equal(payload.dailyGoalMinutes, 20);
  assert.equal(payload.timeZoneId, 'Europe/Berlin');
  assert.equal(payload.notifyEnabled, true);
});

test('пустные необязательные поля уезжают undefined, а не пустой строкой', () => {
  const payload = buildRegistrationPayload(
    { ...base, name: '', level: '', goals: [], minutes: undefined, timezone: undefined },
    null
  );

  assert.equal(payload.displayName, undefined);
  assert.equal(payload.cefrLevel, undefined);
  assert.equal(payload.studyGoal, undefined);
  assert.equal(payload.dailyGoalMinutes, undefined);
  assert.equal(payload.timeZoneId, undefined);
  // honeypot — не «необязательное»: он обязан быть в теле, иначе защита молчит
  assert.equal(payload.website, '');
});

test('метки атрибуции добавляются к телу, а не заменяют его', () => {
  const payload = buildRegistrationPayload(base, { ref: 'stasya', utmSource: 'dzen' });

  assert.equal(payload.ref, 'stasya');
  assert.equal(payload.utmSource, 'dzen');
  assert.equal(payload.email, 'anna@example.com');
  assert.equal(payload.website, '');

  const sentUtmKeys = ['ref', 'utmSource', 'utmMedium', 'utmContent'].filter((key) => payload[key] !== undefined);
  assert.deepEqual(sentUtmKeys, ['ref', 'utmSource']);
});

test('без атрибуции тело остаётся валидным для сервера', () => {
  const payload = buildRegistrationPayload(base, null);

  assert.equal(payload.ref, undefined);
  assert.equal(payload.utmSource, undefined);
});

/**
 * Сам honeypot живёт в разметке, и именно разметка была дырой: сервер ждал
 * поле, а форма его не рендерила.
 */
test('поле для ботов спрятано от пользователя, но не от автозаполнителя', () => {
  const props = honeypotInputProps('https://spam.example', () => {});

  assert.equal(props.name, 'website', 'имя поля должно совпадать с RegisterDto.Website');
  assert.equal(props.autoComplete, 'off');
  assert.equal(props.tabIndex, -1, 'в поле нельзя попасть с Tab: он не часть формы для человека');
  assert.equal(props['aria-hidden'], true, 'экранному читателю поле не нужно — оно не про пользователя');
  assert.equal(props.value, 'https://spam.example');
});

test('скрытие поля не вешается на display:none над всей формой', () => {
  // display:none на родителе полей регистрации — это сломанная доступность
  // реальной формы. Прячем только само поле: абсолют + clipping.
  assert.equal(HONEYPOT_WRAPPER_STYLE.display, undefined);
  assert.equal(HONEYPOT_WRAPPER_STYLE.visibility, undefined);
  assert.equal(HONEYPOT_WRAPPER_STYLE.position, 'absolute');
});

test('страница онбординга рендерит поле и отправляет его в теле регистрации', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'onboarding', 'page.tsx'),
    'utf8'
  );

  assert.match(source, /honeypotInputProps/, 'форма онбординга не рендерит honeypot-поле');
  assert.match(source, /buildRegistrationPayload/, 'форма онбординга не собирает тело через контрактный билдер');
});
