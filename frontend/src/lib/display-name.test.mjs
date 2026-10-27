import test from 'node:test';
import assert from 'node:assert/strict';
import { displayNameOf, isUsableName, FALLBACK_NAME } from './display-name.ts';

/*
 * Имя пользователя — единственное правило на весь UI.
 *
 * Дефект, который этот тест закрывает: имя в онбординге необязательное,
 * DisplayName приходит null, и экраны подставляли email.split('@')[0].
 * В результате приветствие выглядело как «Доброй ночи, audit-1793045167713».
 * Технический идентификатор не должен попадать на экран никогда.
 */

test('берёт displayName как есть', () => {
  assert.equal(displayNameOf('Nikita'), 'Nikita');
});

test('обрезает пробелы по краям', () => {
  assert.equal(displayNameOf('  Nikita  '), 'Nikita');
});

test('пустая строка даёт запасное имя', () => {
  assert.equal(displayNameOf(''), FALLBACK_NAME);
});

test('строка из одних пробелов даёт запасное имя', () => {
  assert.equal(displayNameOf('   '), FALLBACK_NAME);
});

test('null даёт запасное имя', () => {
  assert.equal(displayNameOf(null), FALLBACK_NAME);
});

test('undefined даёт запасное имя', () => {
  assert.equal(displayNameOf(undefined), FALLBACK_NAME);
});

test('email никогда не становится именем', () => {
  assert.equal(displayNameOf('audit-1793045167713@example.com'), FALLBACK_NAME);
});

/*
 * Даже если кто-то передаст email вместо имени — правило это отбивает.
 * Это второй рубеж: первый — не передавать email в displayNameOf.
 */
test('строка с собакой отвергается как имя', () => {
  assert.equal(isUsableName('someone@mail.ru'), false);
  assert.equal(isUsableName('Nikita'), true);
  assert.equal(isUsableName('  '), false);
});

test('email-подобное значение не проходит через displayNameOf в обход правила', () => {
  const out = displayNameOf('user@example.com');
  assert.equal(out, FALLBACK_NAME);
  assert.ok(!out.includes('@'));
});

test('запасное имя человеческое, не техническое', () => {
  assert.equal(FALLBACK_NAME, 'друг');
  assert.ok(!/\d{6,}/.test(FALLBACK_NAME), 'в запасном имени не должно быть числовых хвостов');
});
