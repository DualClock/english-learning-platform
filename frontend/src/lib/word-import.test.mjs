import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_IMPORT_BYTES,
  formatImportSummary,
  hasImportErrors,
  importRequestPath,
  readImportResponse,
  validateImportFile,
} from './word-import.ts';
import { toProxyUrl } from '../app/lib/proxy-path.ts';

/*
 * Массовый импорт слов из CSV/JSON.
 *
 * Тесты держат то, что ломается молча и всплывает только у админа ночью:
 *
 *  1. Файл уходит не туда. Путь обязан склеиваться из id категории, а через
 *     прокси не должен получаться второй `/api` (даёт 404 — этот баг уже
 *     ловили на книгах).
 *  2. Ограничение размера. Бэкенд отдаёт 413 на файл больше 5 МБ. Если фронт
 *     отправит такой файл, админ потратит минуту загрузки и получит
 *     невнятную ошибку вместо «файл больше 5 МБ» — поэтому режем ДО отправки.
 *  3. Номера строк. Ошибка без line бесполезна: админ ищет её глазами в
 *     файле, а не в чужом валидаторе. Ни строка, ни формулировка не должны
 *     теряться при разборе ответа.
 *  4. Сводка. «Добавлено N, пропущено M» с русской плюрализацией: «добавлено
 *     1 слово», а не «добавлено 1 слов».
 *  5. HTTP-ошибки. 413 и 409 — самые частые, и у каждого своё объяснение;
 *     «HTTP 413» админу не говорит ничего.
 */

// ───────────────────────────────────────────────────────────── путь ручки

test('путь импорта склеивается из id категории без второго /api', () => {
  // Проверка пробела: сухой прогон и настоящий импорт — один путь, разница
  // только в query. Так админ гарантированно проверяет ровно то, что зальёт.
  assert.equal(
    importRequestPath(7, true),
    '/api/admin/content/categories/7/words/import?dryRun=true'
  );
  assert.equal(
    importRequestPath(7, false),
    '/api/admin/content/categories/7/words/import?dryRun=false'
  );

  // Через прокси префикс /api/next добавляется один раз: путь бэкенда уже
  // начинается с /api, и toProxyUrl снимает его.
  assert.equal(
    toProxyUrl(importRequestPath(7, true)),
    '/api/next/admin/content/categories/7/words/import?dryRun=true'
  );
});

test('битый id категории не превращается в путь с null', () => {
  // null/NaN в адресе дали бы /categories/null/... и 404 вместо честной
  // ошибки при клике.
  assert.throws(() => importRequestPath(0, true), /категор/i);
  assert.throws(() => importRequestPath(-1, false), /категор/i);
  assert.throws(() => importRequestPath(Number.NaN, true), /категор/i);
  assert.throws(() => importRequestPath(2.5, true), /категор/i);
});

// ─────────────────────────────────────────────────── валидация файла

test('валидный CSV и JSON проходят проверку', () => {
  const csv = validateImportFile({ name: 'words.csv', size: 1024 });
  assert.deepEqual(csv, { ok: true, kind: 'csv', message: null });

  const json = validateImportFile({ name: 'WORDS.Json', size: 1024 });
  assert.deepEqual(json, { ok: true, kind: 'json', message: null });
});

test('нет файла — понятное сообщение, а не молчаливая отправка пустого FormData', () => {
  for (const value of [null, undefined]) {
    const result = validateImportFile(value);
    assert.equal(result.ok, false);
    assert.equal(result.kind, null);
    assert.match(result.message, /выбер/i);
  }
});

test('расширение проверяется до обращения к size', () => {
  // Файл без size (или с size строкой) не должен ронять валидацию: сначала
  // расширение, потом размер.
  const result = validateImportFile({ name: 'words.csv' });
  assert.deepEqual(result, { ok: true, kind: 'csv', message: null });
});

test('неподдерживаемое расширение объясняет, что файл не тот', () => {
  const txt = validateImportFile({ name: 'words.txt', size: 10 });
  assert.equal(txt.ok, false);
  assert.equal(txt.kind, null);
  assert.match(txt.message, /\.csv/);
  assert.match(txt.message, /\.json/);

  // Расширения нет вовсе — тоже отказ, а не «попробуем и посмотрим».
  assert.equal(validateImportFile({ name: 'words', size: 10 }).ok, false);
  // .csvx — не .csv: сравнение по хвосту имени, а не по подстроке.
  assert.equal(validateImportFile({ name: 'words.csvx', size: 10 }).ok, false);
});

test('лимит 5 МБ: ровно 5 МБ проходит, на байт больше — отказ', () => {
  assert.equal(MAX_IMPORT_BYTES, 5 * 1024 * 1024);

  const exact = validateImportFile({ name: 'words.csv', size: MAX_IMPORT_BYTES });
  assert.equal(exact.ok, true);

  const over = validateImportFile({ name: 'words.csv', size: MAX_IMPORT_BYTES + 1 });
  assert.equal(over.ok, false);
  assert.equal(over.kind, null);
  // Тот же текст, что ждём от сервера на 413: админ не должен видеть две
  // разные формулировки одного ограничения.
  assert.equal(over.message, 'файл больше 5 МБ');
});

test('пустой файл отклоняется: импорт из него дал бы 0 и путаницу', () => {
  const empty = validateImportFile({ name: 'words.csv', size: 0 });
  assert.equal(empty.ok, false);
  assert.match(empty.message, /пуст/i);
});

// ───────────────────────────────────────────────────────────── разбор ответа

test('ответ импорта: числа и строки ошибок с номерами строк', () => {
  const parsed = readImportResponse({
    categoryId: 3,
    dryRun: true,
    added: 12,
    skipped: 2,
    errors: [
      { line: 4, message: 'пустой перевод' },
      { line: 9, message: 'слово уже есть' },
    ],
    warnings: [{ line: 11, message: 'слишком длинная транскрипция' }],
  });

  assert.equal(parsed.added, 12);
  assert.equal(parsed.skipped, 2);
  assert.deepEqual(parsed.errors, [
    { line: 4, message: 'пустой перевод' },
    { line: 9, message: 'слово уже есть' },
  ]);
  assert.deepEqual(parsed.warnings, [{ line: 11, message: 'слишком длинная транскрипция' }]);
  assert.equal(parsed.truncated, false);
});

test('ответ: строки в errors как есть не теряются', () => {
  // Если бэкенд когда-нибудь пришлёт строку вместо объекта, element.message
  // дал бы undefined и пустую строку в списке — то есть «ошибка есть, но
  // какая — непонятно». Строка должна дожить до экрана.
  const parsed = readImportResponse({ added: 0, errors: ['файл пустой'], warnings: ['x'] });
  assert.deepEqual(parsed.errors, [{ line: null, message: 'файл пустой' }]);
  assert.deepEqual(parsed.warnings, [{ line: null, message: 'x' }]);
});

test('ответ без номеров строк и с мусором на месте line не теряет сообщение', () => {
  const parsed = readImportResponse({
    added: 1,
    errors: [
      { message: 'без номера строки' },
      { line: '7', message: 'строка пришла строкой' },
      { line: 0, message: 'нулевой номер' },
      { line: 3.5, message: 'дробный номер' },
      null,
      42,
      { line: 5 },
    ],
  });

  assert.deepEqual(parsed.errors, [
    { line: null, message: 'без номера строки' },
    { line: 7, message: 'строка пришла строкой' },
    { line: 0, message: 'нулевой номер' },
    { line: 3.5, message: 'дробный номер' },
    // Объект без message показать нечего — но и выдумывать текст нельзя.
    { line: 5, message: '' },
  ]);
});

test('битый или пустой ответ — нули и пустые списки, без исключения', () => {
  for (const raw of [null, undefined, {}, 'нет', 42, { added: 'много', skipped: null }]) {
    const parsed = readImportResponse(raw);
    assert.equal(parsed.added, 0);
    assert.equal(parsed.skipped, 0);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.truncated, false);
  }
});

test('отрицательные и дробные added/skipped не уезжают в счётчики', () => {
  const parsed = readImportResponse({ added: -5, skipped: 2.7 });
  assert.equal(parsed.added, 0);
  assert.equal(parsed.skipped, 2);
});

test('длинный список ошибок не рендерится целиком: помечаем обрезку', () => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    line: index + 1,
    message: `ошибка ${index + 1}`,
  }));
  const parsed = readImportResponse({ errors: many, warnings: many });

  // Первые записи (ближайшие к началу файла) остаются — с них админ и начнёт.
  assert.ok(parsed.errors.length > 0);
  assert.ok(parsed.errors.length < many.length);
  assert.equal(parsed.errors[0].line, 1);
  assert.equal(parsed.truncated, true);

  // Немного ошибок — обрезки нет.
  const small = readImportResponse({ errors: many.slice(0, 3), warnings: many.slice(0, 3) });
  assert.equal(small.truncated, false);
  assert.equal(small.errors.length, 3);
});

test('hasImportErrors учитывает и ошибки, и предупреждения', () => {
  assert.equal(hasImportErrors({ errors: [], warnings: [] }), false);
  assert.equal(hasImportErrors({ errors: [{ line: 1, message: 'x' }], warnings: [] }), true);
  assert.equal(hasImportErrors({ errors: [], warnings: [{ line: 1, message: 'x' }] }), true);
});

// ─────────────────────────────────────────────────────────────── сводка

test('сводка сухого прогона: «Добавлено N, пропущено M» с плюрализацией', () => {
  const summary = formatImportSummary(
    { added: 4, skipped: 2, errors: [], warnings: [] },
    { dryRun: true }
  );
  assert.equal(summary, 'Добавлено 4 слова, пропущено 2');

  // Плюрализация: 1 слово (форма «one»), 2 — «слова», 5 — «слов».
  const one = formatImportSummary(
    { added: 1, skipped: 1, errors: [], warnings: [] },
    { dryRun: true }
  );
  assert.equal(one, 'Добавлено 1 слово, пропущено 1');

  const two = formatImportSummary(
    { added: 2, skipped: 3, errors: [], warnings: [] },
    { dryRun: true }
  );
  assert.equal(two, 'Добавлено 2 слова, пропущено 3');

  const five = formatImportSummary(
    { added: 5, skipped: 21, errors: [], warnings: [] },
    { dryRun: true }
  );
  assert.equal(five, 'Добавлено 5 слов, пропущено 21');
});

test('сводка настоящего импорта говорит, что запись уже произошла', () => {
  const summary = formatImportSummary(
    { added: 21, skipped: 5, errors: [], warnings: [] },
    { dryRun: false }
  );
  assert.equal(summary, 'Импортировано 21 слово. Пропущено 5');
});

test('сводка учитывает ошибки и не притворяется успехом', () => {
  const withErrors = formatImportSummary(
    {
      added: 0,
      skipped: 3,
      errors: [{ line: 2, message: 'x' }, { line: 4, message: 'y' }],
      warnings: [],
    },
    { dryRun: true }
  );
  assert.match(withErrors, /Добавлено 0 слов/);
  // После предлога падеж другой: «в 2 строках», не «в 2 строки».
  assert.match(withErrors, /Ошибки в 2 строках/);
  assert.match(withErrors, /эти строки будут пропущены/);

  const oneError = formatImportSummary(
    { added: 1, skipped: 0, errors: [{ line: 2, message: 'x' }], warnings: [] },
    { dryRun: false }
  );
  assert.match(oneError, /Импортировано 1 слово/);
  assert.match(oneError, /Ошибка в 1 строке/);
});

test('сводка предупреждений: отдельная фраза, без слова «ошибка»', () => {
  const summary = formatImportSummary(
    { added: 3, skipped: 0, errors: [], warnings: [{ line: 8, message: 'x' }] },
    { dryRun: true }
  );
  assert.match(summary, /3 слова/);
  assert.match(summary, /1 предупреждение/);
  assert.doesNotMatch(summary, /ошибк/i);
});
