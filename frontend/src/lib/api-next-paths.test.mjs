import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

/*
 * Прокси фронта строит адрес как `${API_URL}/api/${path}` (см.
 * app/api/next/[...path]/route.ts). Значит в вызове `fetch('/api/next/...')`
 * сегмент `api` уже учтён, и второй `/api` в аргументе превращается в
 * `/api/api/...` — 404.
 *
 * Этот баг уже ловили руками на книгах классики (осталась память в
 * комментарии в books/page.tsx), но в остальных местах он выжил: добавление
 * рассказа, удаление книги, загрузка EPUB, обложки и аватары молча не
 * работали — сервер отвечал 404, а интерфейс показывал «Не удалось».
 *
 * Тест читает исходники и не даёт вернуть двойной префикс.
 */

const FILES = [
  'app/books/page.tsx',
  'components/AvatarPicker.tsx',
  'app/settings/page.tsx',
  'app/profile/page.tsx',
  'app/dictionary/page.tsx',
  'app/reading/page.tsx',
];

test('ни один вызов /api/next/ не содержит второго /api', () => {
  const offenders = [];

  for (const rel of FILES) {
    let source;
    try {
      source = readFileSync(join(SRC, rel), 'utf8');
    } catch {
      continue; // файла может не быть в этой ветке
    }

    for (const line of source.split('\n')) {
      if (/['"`]\/api\/next\/api\//.test(line)) {
        offenders.push(`${rel}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'двойной /api в пути: прокси уже добавляет /api, получится /api/api/… → 404'
  );
});

test('правильная форма пути встречается в коде книг', () => {
  const source = readFileSync(join(SRC, 'app/books/page.tsx'), 'utf8');
  assert.match(source, /\/api\/next\/books\/popular\//, 'добавление классики должно идти без второго /api');
});
