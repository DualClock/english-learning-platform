/*
 * Юнит-тесты разбора ошибки API.
 *
 * До этого `ApiError` знал только статус и текст: код ошибки
 * (`email_confirmation_required`, `unauthorized`, `email_taken`) жил в
 * `body.error`/`body.code`, но наружу не выходил, и форма не могла отличить
 * «подтвердите почту» от «неверный пароль» — показывала общий текст.
 *
 * Проверяем чистую функцию `parseApiErrorBody`: её же использует `ApiError`,
 * поэтому сценарии в тесте — это реальные тела ответов бэкенда ASP.NET.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, parseApiErrorBody } from '../app/lib/api-client.ts';

test('код ошибки читается из поля error', () => {
  const parsed = parseApiErrorBody(
    JSON.stringify({ error: 'email_confirmation_required', message: 'Подтвердите почту' }),
    403
  );
  assert.equal(parsed.code, 'email_confirmation_required');
  assert.equal(parsed.message, 'Подтвердите почту');
});

test('код ошибки читается из поля code, если error нет', () => {
  const parsed = parseApiErrorBody(JSON.stringify({ code: 'unauthorized' }), 401);
  assert.equal(parsed.code, 'unauthorized');
  assert.equal(parsed.message, 'Ошибка запроса (401)');
});

test('message важнее error как текст, но код сохраняется', () => {
  const parsed = parseApiErrorBody(JSON.stringify({ message: 'Уже занят', error: 'email_taken' }), 409);
  assert.equal(parsed.message, 'Уже занят');
  assert.equal(parsed.code, 'email_taken');
});

test('поле error не считается кодом, если похоже на человеческий текст', () => {
  // Бэкенд иногда отдаёт `{ error: 'Сервис недоступен' }` — это сообщение,
  // а не машинный код, и в `code` ему нельзя: фронт начнёт искать ветку,
  // которой нет.
  const parsed = parseApiErrorBody(JSON.stringify({ error: 'Сервис недоступен' }), 503);
  assert.equal(parsed.code, null);
  assert.equal(parsed.message, 'Сервис недоступен');
});

test('ProblemDetails ASP.NET: title и code', () => {
  const parsed = parseApiErrorBody(
    JSON.stringify({ type: 'about:blank', title: 'Forbidden', status: 403, code: 'email_confirmation_required' }),
    403
  );
  assert.equal(parsed.code, 'email_confirmation_required');
  assert.equal(parsed.message, 'Forbidden');
});

test('валидация в массиве: текст первой ошибки, кода нет', () => {
  const parsed = parseApiErrorBody(
    JSON.stringify([{ errorMessage: 'Пароль слишком короткий' }, { errorMessage: 'Email занят' }]),
    400
  );
  assert.equal(parsed.message, 'Пароль слишком короткий');
  assert.equal(parsed.code, null);
});

test('тело не JSON: текст обрезается, кода нет', () => {
  const parsed = parseApiErrorBody('Bad Gateway', 502);
  assert.equal(parsed.message, 'Bad Gateway');
  assert.equal(parsed.code, null);
});

test('пустое тело даёт общий текст со статусом', () => {
  assert.deepEqual(parseApiErrorBody('', 500), { message: 'Ошибка запроса (500)', code: null });
});

test('ApiError несёт код рядом со статусом', () => {
  const error = new ApiError(403, 'Подтвердите почту', 'email_confirmation_required');
  assert.equal(error.status, 403);
  assert.equal(error.code, 'email_confirmation_required');
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'ApiError');
});

test('ApiError без кода не выдумывает его', () => {
  const error = new ApiError(500, 'Ошибка запроса (500)');
  assert.equal(error.code, null);
});
