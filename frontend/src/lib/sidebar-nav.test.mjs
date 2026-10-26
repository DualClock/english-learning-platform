import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV_GROUPS, isRouteActive, flatRoutes } from './sidebar-nav.ts';

/*
 * Навигация сгруппирована, а не вывалена плоским списком из 16 пунктов.
 * Тесты держат два свойства, которые легко сломать незаметно:
 *   1. ни один маршрут не потерян и не размножен при перегруппировке;
 *   2. подсветка активного пункта работает для подстраниц (/practice/dictation).
 */

test('всего четыре группы', () => {
  assert.equal(NAV_GROUPS.length, 4);
});

test('группы названы по-человечески', () => {
  assert.deepEqual(
    NAV_GROUPS.map((g) => g.label),
    ['Учиться', 'Тренироваться', 'Расти', 'Аккаунт']
  );
});

test('каждый маршрут встречается ровно один раз', () => {
  const routes = flatRoutes();
  assert.equal(new Set(routes).size, routes.length, 'маршрут не должен дублироваться между группами');
});

test('ни один прежний пункт не потерян', () => {
  // Полный список того, что было в плоском меню до перегруппировки.
  const before = [
    '/dashboard', '/books', '/dictionary', '/categories', '/review', '/progress',
    '/profile', '/grammar', '/quiz', '/listening', '/practice/dictation',
    '/practice/pronunciation', '/writing', '/translator', '/settings',
  ];
  const after = flatRoutes();
  for (const route of before) {
    assert.ok(after.includes(route), `пропал пункт меню: ${route}`);
  }
});

test('в каждой группе есть хотя бы один пункт', () => {
  for (const group of NAV_GROUPS) {
    assert.ok(group.items.length > 0, `пустая группа: ${group.label}`);
  }
});

test('у каждого пункта есть ключ иконки и подпись', () => {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      assert.equal(typeof item.name, 'string');
      assert.ok(item.name.length > 0, `пункт ${item.href} без подписи`);
      // Ключ иконки, а не компонент: данные не должны тянуть React,
      // иначе этот тест нельзя прогнать без сборки.
      assert.equal(typeof item.icon, 'string');
      assert.ok(item.icon.length > 0, `у пункта ${item.href} нет иконки`);
    }
  }
});

test('активный пункт подсвечивается на точном совпадении', () => {
  assert.equal(isRouteActive('/books', '/books'), true);
});

test('активный пункт подсвечивается на подстранице', () => {
  assert.equal(isRouteActive('/practice/dictation', '/practice/dictation'), true);
  assert.equal(isRouteActive('/dictionary/lists/3', '/dictionary'), true);
});

test('чужая страница не подсвечивает пункт', () => {
  assert.equal(isRouteActive('/books', '/dashboard'), false);
});

/*
 * Ловушка префиксов: /quiz не должен загораться на /quiz-something,
 * а /practice/dictation — на /practice/dictation-history.
 */
test('похожий префикс не даёт ложную подсветку', () => {
  assert.equal(isRouteActive('/quiz-archive', '/quiz'), false);
  assert.equal(isRouteActive('/practice/dictation-history', '/practice/dictation'), false);
});

test('корневой маршрут ведёт себя предсказуемо', () => {
  assert.equal(isRouteActive('/dashboard', '/dashboard'), true);
  assert.equal(isRouteActive('/dashboard/extra', '/dashboard'), true);
});
