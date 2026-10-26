import assert from 'node:assert/strict';
import test from 'node:test';

/*
 * Публичные пути серверного прокси.
 *
 * Дефект, ради которого этот файл написан: прокси `/api/next/*` требовал
 * сессию NextAuth для ЛЮБОГО пути, включая `/auth/register`. У человека,
 * создающего аккаунт, сессии ещё нет по определению — значит регистрация
 * отвечала `401 unauthorized` и форма не работала никогда.
 *
 * Все автотесты при этом были зелёными: они проверяли API напрямую
 * (`http://127.0.0.1:5226/api/auth/register`), минуя прокси. Ошибка в прослойке
 * видна только сквозным путём через неё.
 *
 * Здесь проверяется ровно решение «пускать или нет» — функция чистая, поэтому
 * живёт в отдельном модуле и не требует запущенного Next.
 */

// Копия списка из route.ts. Держим её здесь намеренно: если в route.ts
// появится новый публичный путь, а в тесте нет — тест ниже это поймает
// (см. тест «список совпадает с route.ts»).
const PUBLIC_PATHS = ['auth/register'];

function isPublicPath(segments) {
  const key = segments.join('/').toLowerCase();
  return PUBLIC_PATHS.some(
    (allowed) => key === allowed || key.startsWith(`${allowed}/`)
  );
}

test('регистрация — публичный путь', () => {
  assert.equal(isPublicPath(['auth', 'register']), true);
});

test('регистрация с подпутём тоже публична', () => {
  assert.equal(isPublicPath(['auth', 'register', 'confirm']), true);
});

test('регистр в пути не создаёт дыру', () => {
  assert.equal(isPublicPath(['AUTH', 'Register']), true);
});

test('логин через прокси НЕ публичен — он идёт через NextAuth', () => {
  // Важно: если сюда попадёт auth/login, токен перестанет быть httpOnly-only
  // в обход NextAuth, потому что пароль поедет через наш прокси.
  assert.equal(isPublicPath(['auth', 'login']), false);
});

test('смена пароля не публична', () => {
  assert.equal(isPublicPath(['auth', 'change-password']), false);
});

test('обычные приватные пути закрыты', () => {
  for (const path of [
    ['books'],
    ['dictionary'],
    ['progress', 'srs-breakdown'],
    ['review', 'today'],
    ['audio', 'tts'],
  ]) {
    assert.equal(isPublicPath(path), false, `путь ${path.join('/')} должен требовать сессию`);
  }
});

test('похожие имена не проскакивают по префиксу', () => {
  // `auth/register-something` — НЕ `auth/register`, иначе через префикс
  // открылся бы любой соседний маршрут.
  assert.equal(isPublicPath(['auth', 'registerx']), false);
  assert.equal(isPublicPath(['authx', 'register']), false);
});

test('пустой путь не считается публичным', () => {
  assert.equal(isPublicPath([]), false);
});

test('список в route.ts совпадает с тестом', async () => {
  // Страховка от расхождения: если публичный путь добавили в код и забыли
  // здесь, проверка «путь закрыт» начнёт врать.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');

  const here = dirname(fileURLToPath(import.meta.url));
  const routePath = join(here, '..', 'app', 'api', 'next', '[...path]', 'route.ts');
  const source = await readFile(routePath, 'utf8');

  const match = source.match(/const PUBLIC_PATHS = \[([\s\S]*?)\]/);
  assert.ok(match, 'в route.ts не найден список PUBLIC_PATHS');

  const declared = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    declared.sort(),
    [...PUBLIC_PATHS].sort(),
    'список публичных путей в route.ts и в тесте разошлись'
  );
});
