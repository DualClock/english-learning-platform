import test from 'node:test';
import assert from 'node:assert/strict';

import { describeImportHttpError, parseImportErrorBody } from './word-import.ts';

/*
 * HTTP-ошибки импорта слов.
 *
 * Админ работает с этим экраном редко и не помнит кодов. «HTTP 413» он
 * прочитает как «что-то сломалось» и пойдёт к разработчику, хотя всего лишь
 * нужен файл поменьше. Поэтому каждый статус объясняется действием, а тело
 * ProblemDetails подклеивается, если сервер прислал что-то осмысленное.
 *
 * Отдельный файл: проверки не пересекаются с разбором успешного ответа.
 */

test('413 — файл больше 5 МБ, той же формулировкой, что проверка до отправки', () => {
  const text = describeImportHttpError({ status: 413, body: null });
  assert.equal(text, 'файл больше 5 МБ');
});

test('409 — конфликт, ничего не записано: админу важно, что база не изменилась', () => {
  const plain = describeImportHttpError({ status: 409, body: null });
  assert.match(plain, /конфликт/i);
  assert.match(plain, /ничего не (записано|сохранено)/i);

  // Реальное тело 409 контроллера: русский текст в error + текст исключения
  // БД в detail. Показываем объяснение сервера, а наружу — не текст SQL.
  const real = describeImportHttpError({
    status: 409,
    body: {
      error: 'Импорт отменён: часть слов конфликтует с существующими. Ничего не записано.',
      detail: '23505: duplicate key value violates unique constraint',
    },
  });
  assert.match(real, /Импорт отменён/);
  assert.match(real, /Ничего не записано/);
  assert.doesNotMatch(real, /duplicate key|23505/);
});

test('400 — текст сервера из поля error, как его шлёт контроллер импорта', () => {
  // Реальный 400 контроллера: { error: "Не удалось прочитать файл: …" }.
  // Если смотреть только на message/detail, админ получит общий совет вместо
  // причины, которую сервер уже назвал.
  const fromError = describeImportHttpError({
    status: 400,
    body: { error: 'Не удалось прочитать файл: файл не в UTF-8' },
  });
  assert.equal(fromError, 'Не удалось прочитать файл: файл не в UTF-8');

  const fromMessage = describeImportHttpError({
    status: 400,
    body: { message: 'Неизвестный формат файла' },
  });
  assert.equal(fromMessage, 'Неизвестный формат файла');

  const bare = describeImportHttpError({ status: 400, body: null });
  assert.match(bare, /формат/i);
});

test('400: error важнее detail — в detail у сервера текст исключения БД', () => {
  const text = describeImportHttpError({
    status: 400,
    body: { error: 'Не удалось прочитать файл', detail: 'System.NullReferenceException: …' },
  });
  assert.equal(text, 'Не удалось прочитать файл');
  assert.doesNotMatch(text, /NullReference/);
});

test('404 — категории нет, файл тут ни при чём', () => {
  const text = describeImportHttpError({ status: 404, body: { error: 'Not Found' } });
  assert.match(text, /категор/i);
  // Код ответа не должен затирать текст: «Not Found» админу бесполезен.
  assert.doesNotMatch(text, /^Not Found$/);
});

test('401/403 — это про роль, а не про файл', () => {
  for (const status of [401, 403]) {
    const text = describeImportHttpError({ status, body: null });
    assert.match(text, /права|администратор/i, `статус ${status}`);
  }
});

test('прочие коды и сетевой сбой — понятная фраза, а не пустая строка', () => {
  for (const status of [418, 500, 502, 0]) {
    const text = describeImportHttpError({ status, body: null });
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /^\s*$/);
  }
  // Код сохраняем: по нему разработчик находит запрос в логах.
  assert.match(describeImportHttpError({ status: 500, body: null }), /500/);

  // Тело не JSON и не объект — не падаем.
  assert.ok(describeImportHttpError({ status: 500, body: 'Internal error text' }).length > 0);
  assert.ok(describeImportHttpError({ status: 500, body: [1, 2, 3] }).length > 0);
});

test('parseImportErrorBody: message → title → error → detail', () => {
  assert.equal(parseImportErrorBody({ message: 'M', title: 'T', detail: 'D' }), 'M');
  assert.equal(parseImportErrorBody({ title: 'T', detail: 'D' }), 'T');
  // error выше detail: сервер кладёт туда причину, а в detail — текст исключения.
  assert.equal(parseImportErrorBody({ error: 'E', detail: 'D' }), 'E');
  assert.equal(parseImportErrorBody({ detail: 'D' }), 'D');
  assert.equal(parseImportErrorBody(null), null);
  assert.equal(parseImportErrorBody('строка'), 'строка');
  assert.equal(parseImportErrorBody('   '), null);
  assert.equal(parseImportErrorBody({ message: '  ' }), null);
  assert.equal(parseImportErrorBody({ message: 42 }), null);
});
