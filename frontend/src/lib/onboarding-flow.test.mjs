import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ONBOARDING_STEPS,
  POST_SIGNUP_PATH,
  canSubmitAccount,
  isValidEmail,
  isValidPassword,
  levelFromQuery,
  stepNumber,
  totalSteps,
  welcomeHeadline,
} from './onboarding-flow.ts';

test('онбординг состоит из двух шагов, и первый — аккаунт', () => {
  assert.equal(totalSteps(), 2);
  assert.deepEqual(ONBOARDING_STEPS, ['account', 'goal']);
  assert.equal(stepNumber('account'), 1);
  assert.equal(stepNumber('goal'), 2);
});

test('теста уровня в онбординге нет: он живёт на /test, результат приходит адресом', () => {
  const steps = ONBOARDING_STEPS;
  assert.ok(!steps.includes('placement'));
  assert.ok(!steps.includes('level'));
});

test('уровень читается из адреса в любом регистре и с пробелами', () => {
  assert.equal(levelFromQuery('b1'), 'b1');
  assert.equal(levelFromQuery(' B1 '), 'b1');
  assert.equal(levelFromQuery('C1'), 'c1');
});

test('несуществующий уровень не подменяется значением по умолчанию', () => {
  // Иначе в профиль запишется неправда, а профиль влияет на рекомендации книг.
  assert.equal(levelFromQuery('z9'), null);
  assert.equal(levelFromQuery(''), null);
  assert.equal(levelFromQuery(null), null);
  assert.equal(levelFromQuery(undefined), null);
});

test('после регистрации ведём в библиотеку, а не на дашборд', () => {
  assert.equal(POST_SIGNUP_PATH, '/books?first=1');
  assert.ok(!POST_SIGNUP_PATH.startsWith('/dashboard'));
});

test('форма отправляется по email и паролю — имя не требуется', () => {
  assert.equal(canSubmitAccount({ email: 'a@b.co', password: '123456' }), true);
  assert.equal(canSubmitAccount({ email: 'a@b.co', password: '12345' }), false);
  assert.equal(canSubmitAccount({ email: 'не-адрес', password: '123456' }), false);
});

test('пароль из одних пробелов не считается введённым', () => {
  assert.equal(isValidPassword('      '), false);
  // len(' 12345 ') === 7, но значимых символов 5 — именно их и считаем,
  // иначе пробелы по краям проходят как «шестой символ».
  assert.equal(isValidPassword(' 12345 '), false);
  assert.equal(isValidPassword(' 123456 '), true);
});

test('email проверяется без требований, которые сервер всё равно не выполняет', () => {
  assert.equal(isValidEmail('user@example.com'), true);
  assert.equal(isValidEmail(' user@example.com '), true);
  assert.equal(isValidEmail('user@example'), false);
  assert.equal(isValidEmail('@example.com'), false);
});

test('приветствие не оставляет «Добро пожаловать, !» при пустом имени', () => {
  assert.equal(welcomeHeadline('Аня'), 'Добро пожаловать, Аня!');
  assert.equal(welcomeHeadline('   '), 'Добро пожаловать!');
  assert.equal(welcomeHeadline(null), 'Добро пожаловать!');
});
