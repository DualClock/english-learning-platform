import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSISTANT_LEVELS,
  articleDraftRequest,
  articleDraftToForm,
  assistantStatusLabel,
  isAssistantDisabled,
  normalizeAssistantError,
  normalizeAssistantStatus,
  replaceConfirmMessage,
  toArticleDraft,
} from './assistant.ts';

/*
 * AI-ассистент статьи: чистая часть.
 *
 * Без браузера проверяем ровно то, что ломается тихо:
 *  - пустую «тему» нельзя отправлять как вызов ИИ: она сожжёт дневной лимит и
 *    вернёт пустой черновик;
 *  - 429/503 надо различать: лимит — «ждать до завтра», недоступность — «ИИ
 *    выключен»; перепутать значит отправить админа жать кнопку ещё раз впустую;
 *  - статус лимита приходит числами, и «0 из 0» не должен выглядеть рабочим.
 */

// ─────────────────────────────────────────────────────────── статус лимита

test('статус ассистента читается из ответа и считает остаток', () => {
  const status = normalizeAssistantStatus({ limit: 20, used: 3, remaining: 17, enabled: true });
  assert.deepEqual(status, { limit: 20, used: 3, remaining: 17, enabled: true });
  assert.equal(assistantStatusLabel(status), 'Осталось 17 из 20 вызовов сегодня');
});

test('остаток не бывает отрицательным и не противоречит использованному', () => {
  // remaining пришёл битым — считаем сами из limit - used.
  assert.deepEqual(normalizeAssistantStatus({ limit: 10, used: 4 }), {
    limit: 10,
    used: 4,
    remaining: 6,
    enabled: true,
  });
  // Использовано больше лимита — остаток 0, а не -3.
  assert.equal(normalizeAssistantStatus({ limit: 10, used: 13, remaining: -3 }).remaining, 0);
});

test('битый или пустой ответ статуса не роняет панель', () => {
  const status = normalizeAssistantStatus(null);
  assert.equal(status.limit, 0);
  assert.equal(status.remaining, 0);
  // Считать ассистента выключенным на битом ответе нельзя: тогда админ
  // потеряет кнопку из-за одной неудачной загрузки статуса.
  assert.equal(status.enabled, true);
  assert.equal(normalizeAssistantStatus({ limit: 'много', used: 2.7 }).used, 2);
});

test('enabled=false выключает ассистента, и подпись говорит почему', () => {
  const status = normalizeAssistantStatus({ limit: 20, used: 0, remaining: 20, enabled: false });
  assert.equal(isAssistantDisabled(status), true);
  assert.match(assistantStatusLabel(status), /недоступен|выключен администратором/i);

  const empty = normalizeAssistantStatus({ limit: 20, used: 20, remaining: 0, enabled: true });
  assert.equal(isAssistantDisabled(empty), true);
  assert.match(assistantStatusLabel(empty), /лимит/i);
});

test('лимит израсходован — кнопка недоступна, но ассистент включён', () => {
  const status = normalizeAssistantStatus({ limit: 5, used: 5, remaining: 0, enabled: true });
  assert.equal(status.enabled, true);
  assert.equal(isAssistantDisabled(status), true);
  assert.match(assistantStatusLabel(status), /^Осталось 0 из 5 вызовов сегодня/);
  assert.match(assistantStatusLabel(status), /лимит исчерпан/i);
});

// ───────────────────────────────────────────────────────── тело запроса

test('уровни: только A1–C1, как обещает бэкенд', () => {
  assert.deepEqual([...ASSISTANT_LEVELS], ['A1', 'A2', 'B1', 'B2', 'C1']);
});

test('тело запроса статьи: тема обязательна, пустые поля не уезжают', () => {
  assert.deepEqual(articleDraftRequest({ topic: '  Present Perfect  ' }), {
    topic: 'Present Perfect',
  });
  assert.deepEqual(articleDraftRequest({ topic: 'Артикли', level: 'B1', audience: ' 6 класс ' }), {
    topic: 'Артикли',
    level: 'B1',
    audience: '6 класс',
  });
  // Пустая строка вместо undefined — сервер получил бы аудиторию «""».
  assert.deepEqual(articleDraftRequest({ topic: 'Тема', level: '', audience: '   ' }), {
    topic: 'Тема',
  });
});

test('пустая тема не превращается в запрос', () => {
  assert.equal(articleDraftRequest({ topic: '' }), null);
  assert.equal(articleDraftRequest({ topic: '   ' }), null);
  assert.equal(articleDraftRequest({ topic: null }), null);
});

test('неизвестный уровень отбрасывается, а не отправляется на сервер', () => {
  assert.deepEqual(articleDraftRequest({ topic: 'Т', level: 'Z9' }), { topic: 'Т' });
  assert.deepEqual(articleDraftRequest({ topic: 'Т', level: 'b1' }), { topic: 'Т', level: 'B1' });
});

// ─────────────────────────────────────────────────────────────── черновик

test('черновик из ответа: заголовок и тело', () => {
  const draft = toArticleDraft({ title: 'Present Perfect', bodyMarkdown: '## Текст' });
  assert.deepEqual(draft, { title: 'Present Perfect', bodyMarkdown: '## Текст' });
});

test('черновик без заголовка или тела — null: подставлять нечего', () => {
  assert.equal(toArticleDraft({ title: '', bodyMarkdown: 'текст' }), null);
  assert.equal(toArticleDraft({ title: 'Заголовок', bodyMarkdown: '   ' }), null);
  assert.equal(toArticleDraft(null), null);
  assert.equal(toArticleDraft({ title: 'T' }), null);
});

test('черновик заполняет форму, не затирая раздел и не трогая slug по умолчанию', () => {
  const form = { title: 'Старое', slug: '', summary: 'Анонс', sectionId: '3', bodyMarkdown: '' };
  const next = articleDraftToForm(form, { title: 'Новое', bodyMarkdown: '# Тело' });
  assert.deepEqual(next, {
    title: 'Новое',
    slug: '',
    summary: 'Анонс',
    sectionId: '3',
    bodyMarkdown: '# Тело',
  });
  // Исходная форма не мутируется.
  assert.equal(form.title, 'Старое');
});

test('подтверждение спрашивается только когда текст уже написан', () => {
  assert.equal(replaceConfirmMessage('   '), null);
  assert.equal(replaceConfirmMessage(''), null);
  assert.equal(replaceConfirmMessage(null), null);
  const message = replaceConfirmMessage('старый текст');
  assert.ok(message);
  assert.match(message, /заменить/i);
});

// ────────────────────────────────────────────────────────────── ошибки

test('код ошибки приходит числом — 429 и 503 узнаются и по статусу', () => {
  assert.equal(normalizeAssistantError(429, { error: 'Дневной лимит исчерпан' }).kind, 'limit');
  assert.equal(normalizeAssistantError(503, { error: 'Ассистент недоступен' }).kind, 'unavailable');
  assert.equal(normalizeAssistantError(400, { error: 'Тема обязательна' }).kind, 'bad-request');
  assert.equal(normalizeAssistantError(403, {}).kind, 'forbidden');
});

test('текст из поля error доходит до человека как есть', () => {
  const limit = normalizeAssistantError(429, { error: 'Суточный лимит: 20 вызовов' });
  assert.equal(limit.message, 'Суточный лимит: 20 вызовов');
  assert.equal(limit.kind, 'limit');

  const off = normalizeAssistantError(503, { error: 'ИИ выключен в настройках' });
  assert.equal(off.message, 'ИИ выключен в настройках');
  assert.equal(off.kind, 'unavailable');
});

test('без текста ошибки подставляется своё, но не код HTTP', () => {
  const limit = normalizeAssistantError(429, null);
  assert.match(limit.message, /лимит/i);
  assert.equal(limit.message.includes('429'), false);

  const off = normalizeAssistantError(503, {});
  assert.match(off.message, /недоступен|выключен/i);
  assert.equal(off.message.includes('503'), false);
});

test('не-JSON тело и неизвестный статус не оставляют пустую плашку', () => {
  const html = normalizeAssistantError(502, '<html>Bad Gateway</html>');
  assert.equal(html.kind, 'unknown');
  assert.equal(html.message, '<html>Bad Gateway</html>');

  const empty = normalizeAssistantError(500, '');
  assert.ok(empty.message.length > 0);
  assert.equal(empty.kind, 'unknown');
});

test('сетевой сбой: kind=network и совет проверить связь', () => {
  const network = normalizeAssistantError(0, null);
  assert.equal(network.kind, 'network');
  assert.match(network.message, /связ|сеть|повтор/i);

  // Fetch упал: статуса нет вовсе, сообщение — английское «Failed to fetch».
  const offline = normalizeAssistantError(new TypeError('Failed to fetch'));
  assert.equal(offline.kind, 'network');
  assert.match(offline.message, /связ|сеть|повтор/i);
  assert.equal(offline.message.includes('fetch'), false);
});

test('готовый Error из клиента разбирается по полю сообщения', () => {
  const error = normalizeAssistantError(new Error('Ассистент выключен администратором'));
  assert.equal(error.message, 'Ассистент выключен администратором');

  const status = normalizeAssistantError({ status: 429, message: 'Лимит' });
  assert.equal(status.kind, 'limit');
  assert.equal(status.message, 'Лимит');

  // Ошибка клиента — всегда {status, data}: текст берём из data.error.
  const body = normalizeAssistantError({ status: 503, data: { error: 'ИИ недоступен' } });
  assert.deepEqual(body, { kind: 'unavailable', message: 'ИИ недоступен' });
});
