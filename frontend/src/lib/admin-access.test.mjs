/*
 * Проверка role-гейта /admin на уровне чистой логики.
 *
 * Middleware сам по себе не тестируется (тянет next/server), поэтому всё, что
 * решает «пускать или нет», вынесено в admin-access.ts и проверяется здесь.
 * Цена ошибки асимметрична: ложный пропуск отдаёт админку любому, ложный
 * запрет закрывает её владельцу.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_ROLE,
  hasAdminRole,
  hasSessionCookie,
  sessionCookieNames,
} from './admin-access.ts';

test('ADMIN_ROLE совпадает с AppRoles.Admin в C#', () => {
  // Строка продублирована в двух языках — это единственное место, где она
  // проверяется. Расхождение даёт 404 админу при верной куке.
  assert.equal(ADMIN_ROLE, 'Admin');
});

test('роль Admin даёт доступ', () => {
  assert.equal(hasAdminRole(['Admin']), true);
});

test('Admin среди нескольких ролей тоже даёт доступ', () => {
  assert.equal(hasAdminRole(['User', 'Admin']), true);
});

test('пустой список ролей — отказать', () => {
  assert.equal(hasAdminRole([]), false);
});

test('User без Admin — отказать', () => {
  assert.equal(hasAdminRole(['User']), false);
});

test('undefined и null — отказать, а не упасть', () => {
  assert.equal(hasAdminRole(undefined), false);
  assert.equal(hasAdminRole(null), false);
});

test('регистр роли значим: "admin" не равно "Admin"', () => {
  // Identity сравнивает роли ordinal-регистронезависимо, но claim пишется
  // ровно как в AppRoles. Принимать произвольный регистр здесь — значит
  // расширять гейт молча.
  assert.equal(hasAdminRole(['admin']), false);
  assert.equal(hasAdminRole(['ADMIN']), false);
});

test('имя куки без https — только небезопасное', () => {
  assert.deepEqual(sessionCookieNames('http://localhost:3100'), [
    'next-auth.session-token',
  ]);
  assert.deepEqual(sessionCookieNames(undefined), ['next-auth.session-token']);
});

test('имя куки на https — __Secure- первым', () => {
  const names = sessionCookieNames('https://lexicon.example');
  assert.equal(names[0], '__Secure-next-auth.session-token');
  assert.ok(names.includes('next-auth.session-token'));
});

test('hasSessionCookie: нет куки — false', () => {
  const request = { cookies: { get: () => undefined } };
  assert.equal(hasSessionCookie(request, 'http://localhost:3100'), false);
});

test('hasSessionCookie: пустое значение куки — false', () => {
  const request = { cookies: { get: () => ({ value: '' }) } };
  assert.equal(hasSessionCookie(request, 'http://localhost:3100'), false);
});

test('hasSessionCookie: кука есть — true', () => {
  const request = { cookies: { get: () => ({ value: 'jwe.token.value' }) } };
  assert.equal(hasSessionCookie(request, 'http://localhost:3100'), true);
});

test('hasSessionCookie: __Secure- кука на https подходит', () => {
  const request = {
    cookies: {
      get: (name) =>
        name === '__Secure-next-auth.session-token' ? { value: 'x' } : undefined,
    },
  };
  assert.equal(hasSessionCookie(request, 'https://lexicon.example'), true);
});
