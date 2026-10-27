import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isMostlyCyrillic, shouldUseServerTts } from './tts.ts';

/*
 * Выбор движка озвучки.
 *
 * Ошибка этого класса выглядит не как падение, а как «странный голос»: русский
 * перевод, отправленный в английскую нейросеть, читается по слогам латиницей, и
 * человек решает, что у нас плохой продукт. Поэтому проверяются оба направления
 * правила и пограничные смешанные строки.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(join(here, ...segments), 'utf8');

const hook = read('..', 'hooks', 'useTts.ts');

test('латиница идёт на серверный голос', () => {
  assert.equal(shouldUseServerTts('white rabbit'), true);
  assert.equal(shouldUseServerTts("Alice was beginning to get very tired."), true);
  assert.equal(isMostlyCyrillic('rabbit'), false);
});

test('кириллица остаётся у браузера', () => {
  assert.equal(shouldUseServerTts('белый кролик'), false);
  assert.equal(isMostlyCyrillic('кролик'), true);
});

test('смешанные строки решаются в пользу большинства букв', () => {
  assert.equal(isMostlyCyrillic('белый кролик rabbit'), true);
  assert.equal(isMostlyCyrillic('rabbit белый'), false);
  // Ровное количество букв — не «русский»: спорная строка уезжает на сервер,
  // где её хотя бы слышно.
  assert.equal(isMostlyCyrillic('кролик rabbit'), false);
});

test('пустой текст никуда не отправляется', () => {
  assert.equal(shouldUseServerTts(''), false);
  assert.equal(shouldUseServerTts('   '), false);
});

test('хук действительно спрашивает lib, а не гадает на месте', () => {
  assert.match(hook, /shouldUseServerTts/);
  assert.match(hook, /from '@\/lib\/tts'/);
});

test('долгая генерация не оставляют клик без звука', () => {
  // Замер на проде: новое слово через прокси собирается ~15 с, из кэша — 0,4 с.
  // Без окна ожидания первый клик по слову был бы тишиной на пятнадцать секунд.
  assert.match(hook, /SERVER_GRACE_MS\s*=\s*\d+/);
  assert.match(hook, /Promise\.race/);
});

test('ни один потребитель озвучки не остался на голом браузерном синтезе', () => {
  const consumers = [
    // Страница книги теперь тонкая оболочка, а слово озвучивает WordSheet.
    read('..', 'components', 'reader', 'WordSheet.tsx'),
    read('..', 'app', 'review', 'page.tsx'),
    read('..', 'app', 'translator', 'page.tsx'),
    read('..', 'app', 'dictionary', 'lists', '[id]', 'page.tsx'),
    read('..', 'app', 'dictionary', 'lists', '[id]', 'practice', 'page.tsx'),
    read('..', 'components', 'dictionary', 'DictionaryWordRow.tsx'),
  ];

  for (const source of consumers) {
    assert.match(source, /useTts/, 'потребитель должен брать серверный голос');
    assert.doesNotMatch(source, /new SpeechSynthesisUtterance/, 'сам браузерный вызов остаётся только в useSpeech');
  }
});

test('браузерный голос остаётся только резервом для главы', () => {
  // Глава читается с сервера; браузерный синтез — тихий fallback, когда
  // ключа Azure нет или кончился лимит. Поэтому вызов живёт ровно в двух
  // местах: в useSpeech для слов и в useListening для главы.
  const listening = read('..', 'hooks', 'reader', 'useListening.ts');
  assert.match(listening, /SpeechSynthesisUtterance/);
  assert.match(listening, /provider.*browser/s);
  assert.match(listening, /getSpeechManifest/);
});
