/*
 * Проверка: видит ли админ пункт «Админка» в SSR-меню.
 *
 * Зачем скрипт: браузерная сессия в этом окружении цепляется за чужой
 * localhost:4173, и скриншоты показывают не тот сайт. Здесь вместо браузера
 * проверяется то, что реально уходит в HTML — результат navGroupsFor при роли
 * Admin, — и отдельно, что юзер без роли этого блока не получает.
 */
import { navGroupsFor, ADMIN_NAV_GROUP } from '../src/lib/sidebar-nav.ts';

const adminGroups = navGroupsFor(['Admin']);
const userGroups = navGroupsFor([]);
const anonGroups = navGroupsFor(null);

console.log('=== АДМИН ===');
console.log('группы:', adminGroups.map((g) => g.label).join(' → '));
console.log('первая группа:', adminGroups[0].label);
console.log('пункты:', adminGroups[0].items.map((i) => `${i.name} (${i.href})`).join(', '));

console.log('\n=== ОБЫЧНЫЙ ПОЛЬЗОВАТЕЛЬ ===');
console.log('группы:', userGroups.map((g) => g.label).join(' → '));
console.log('есть админка:', userGroups.some((g) => g.label === 'Админка'));

console.log('\n=== БЕЗ СЕССИИ ===');
console.log('есть админка:', anonGroups.some((g) => g.label === 'Админка'));

const ok =
  adminGroups[0].label === 'Админка' &&
  adminGroups[0].items.length === ADMIN_NAV_GROUP.items.length &&
  !userGroups.some((g) => g.label === 'Админка') &&
  !anonGroups.some((g) => g.label === 'Админка');

console.log('\nИТОГ:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
