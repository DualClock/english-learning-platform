import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  clampCharOffset,
  clampPage,
  pageCountFromLastLeft,
  pageIndexFromLeft,
  wordProgressPercent,
} from './pagination.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(join(here, ...segments), 'utf8');

test('номер страницы не выходит за пределы главы', () => {
  assert.equal(clampPage(-4, 17), 0);
  assert.equal(clampPage(0, 17), 0);
  assert.equal(clampPage(16, 17), 16);
  assert.equal(clampPage(99, 17), 16);
  assert.equal(clampPage(Number.NaN, 17), 0);
  assert.equal(clampPage(3, 0), 0);
});

test('страница определяется по левому краю символа', () => {
  const width = 327.625;
  assert.equal(pageIndexFromLeft(31.1875, 31.1875, width), 0);
  assert.equal(pageIndexFromLeft(31.1875 + width, 31.1875, width), 1);
  assert.equal(pageIndexFromLeft(31.1875 + width * 35, 31.1875, width), 35);
});

test('дробная ширина колонки не накапливает сдвиг к последней странице', () => {
  const left = 31.1875;
  const exact = 327.625;
  const lastChar = left + exact * 35 + 10;
  assert.equal(pageIndexFromLeft(lastChar, left, exact), 35);
  assert.equal(pageCountFromLastLeft(lastChar, left, exact), 36);

  // Регрессия: округление 327,625 до 328 «теряло» страницу и подрезало
  // левый край текста — на 36-й странице ошибка была больше десяти пикселей.
  assert.equal(pageIndexFromLeft(lastChar, left, 328), 34);
});

test('якорь внутри предложения не выходит за его длину', () => {
  assert.equal(clampCharOffset(-3, 20), 0);
  assert.equal(clampCharOffset(0, 20), 0);
  assert.equal(clampCharOffset(19, 20), 19);
  assert.equal(clampCharOffset(999, 20), 19);
  assert.equal(clampCharOffset(5, 0), 0);
});

test('процент книги считается по словам и не выходит за сто', () => {
  assert.equal(wordProgressPercent(0, 1000), 0);
  assert.equal(wordProgressPercent(500, 1000), 50);
  assert.equal(wordProgressPercent(999, 1000), 99.9);
  assert.equal(wordProgressPercent(2000, 1000), 100);
  assert.equal(wordProgressPercent(5, 0), 0);
});

test('движок перелистывает на измеренную ширину колонки, а не на округлённую', () => {
  const hook = read('..', '..', 'hooks', 'reader', 'usePaginator.ts');
  assert.match(hook, /const pageWidth = flowRect\.width/);
  assert.match(hook, /translate3d\(\$\{-nextPage \* pageWidth\}px/);
  // Шаг не должен снова стать Math.floor(viewport.clientWidth): именно это
  // и дало накопительный сдвиг в спайке.
  assert.doesNotMatch(hook, /translate3d\(\$\{-nextPage \* width\}px/);
});

test('перевёрстка сохраняет исходный якорь, а не первую строку новой страницы', () => {
  const hook = read('..', '..', 'hooks', 'reader', 'usePaginator.ts');
  assert.match(hook, /anchorResolved/);
  assert.match(hook, /emitAfterPaint\(nextPage, total, 0, anchorResolved \? anchor : null\)/);
});
