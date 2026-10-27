import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, renderMarkdownPreview, safeHref } from './markdown-preview.ts';

/*
 * Предпросмотр markdown в форме статьи.
 *
 * Главное здесь — не красота разметки, а безопасность: результат уходит в
 * dangerouslySetInnerHTML, и любая дыра в экранировании становится XSS в панели
 * администратора. Поэтому тесты делятся на две группы:
 *   1. разметка рендерится так, как ожидает автор текста;
 *   2. ни один сырой `<`, `javascript:` или `onerror=` из ввода не пропускается.
 */

// ─────────────────────────────────────────────────────── экранирование

test('escapeHtml закрывает все пять опасных символов', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  // Плюс не должен превращаться в пробел (это делал бы encodeURIComponent).
  assert.equal(escapeHtml('a + b'), 'a + b');
});

test('escapeHtml не падает на не-строках', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '');
});

// ──────────────────────────────────────────────────────── http-ссылки

test('safeHref пропускает только http, https и mailto', () => {
  assert.equal(safeHref('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeHref('http://example.com'), 'http://example.com');
  assert.equal(safeHref('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(safeHref('/articles/foo'), '/articles/foo');
  assert.equal(safeHref('#anchor'), '#anchor');
  assert.equal(safeHref('  https://example.com  '), 'https://example.com');
});

test('safeHref отбрасывает javascript:, data: и vbscript:', () => {
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('JaVaScRiPt:alert(1)'), '');
  assert.equal(safeHref(' javascript:alert(1)'), '');
  assert.equal(safeHref('java\tscript:alert(1)'), '');
  assert.equal(safeHref('java\u0000script:alert(1)'), '');
  assert.equal(safeHref('data:text/html;base64,PHNjcmlwdD4='), '');
  assert.equal(safeHref('vbscript:msgbox(1)'), '');
  assert.equal(safeHref(''), '');
  assert.equal(safeHref(null), '');
});

// ─────────────────────────────────────────────────────────────── разметка

test('заголовки h1–h3, более глубокие — обычным текстом под h3', () => {
  assert.equal(renderMarkdownPreview('# Один'), '<h1>Один</h1>');
  assert.equal(renderMarkdownPreview('## Два'), '<h2>Два</h2>');
  assert.equal(renderMarkdownPreview('### Три'), '<h3>Три</h3>');
  assert.equal(renderMarkdownPreview('###### Шесть'), '<h3>Шесть</h3>');
  // Решётка без пробела — не заголовок.
  assert.equal(renderMarkdownPreview('#Хэштег'), '<p>#Хэштег</p>');
});

test('абзацы разделяются, одиночный перенос внутри абзаца — <br>', () => {
  assert.equal(renderMarkdownPreview('Первый\nвторой'), '<p>Первый<br>второй</p>');
  assert.equal(renderMarkdownPreview('А\n\nБ'), '<p>А</p><p>Б</p>');
  assert.equal(renderMarkdownPreview('строчка\n\n\n\nдругая'), '<p>строчка</p><p>другая</p>');
});

test('маркированные списки: и «-», и «*», и «+»', () => {
  const expected = '<ul><li>один</li><li>два</li></ul>';
  assert.equal(renderMarkdownPreview('- один\n- два'), expected);
  assert.equal(renderMarkdownPreview('* один\n* два'), expected);
  assert.equal(renderMarkdownPreview('+ один\n+ два'), expected);
});

test('нумерованный список начинает нумерацию заново после другого блока', () => {
  assert.equal(
    renderMarkdownPreview('1. один\n2. два\n\nТекст\n\n1. снова'),
    '<ol><li>один</li><li>два</li></ol><p>Текст</p><ol><li>снова</li></ol>'
  );
});

test('смешанные списки: перенос строки без маркера продолжает пункт', () => {
  assert.equal(
    renderMarkdownPreview('- пункт\n  продолжение\n- второй'),
    '<ul><li>пункт продолжение</li><li>второй</li></ul>'
  );
});

test('жирный, курсив и инлайн-код', () => {
  assert.equal(renderMarkdownPreview('**важно**'), '<p><strong>важно</strong></p>');
  assert.equal(renderMarkdownPreview('__важно__'), '<p><strong>важно</strong></p>');
  assert.equal(renderMarkdownPreview('*курсив*'), '<p><em>курсив</em></p>');
  assert.equal(renderMarkdownPreview('_курсив_'), '<p><em>курсив</em></p>');
  assert.equal(renderMarkdownPreview('`код`'), '<p><code>код</code></p>');
  assert.equal(
    renderMarkdownPreview('**жирное *и курсив* внутри**'),
    '<p><strong>жирное <em>и курсив</em> внутри</strong></p>'
  );
});

test('подчёркивания внутри слова не превращаются в курсив', () => {
  assert.equal(renderMarkdownPreview('snake_case_name'), '<p>snake_case_name</p>');
});

test('code-блок сохраняет содержимое дословно и не разбирает разметку', () => {
  assert.equal(
    renderMarkdownPreview('```js\nconst a = **1**;\n```'),
    '<pre><code class="language-js">const a = **1**;</code></pre>'
  );
  // Без языка — без класса.
  assert.equal(renderMarkdownPreview('```\nx < y\n```'), '<pre><code>x &lt; y</code></pre>');
});

test('незакрытый code-блок не проглатывает весь хвост молча без закрытия', () => {
  // Открыли ```, а закрытия нет — текст всё равно показывается как код до конца.
  assert.equal(renderMarkdownPreview('```\nabc'), '<pre><code>abc</code></pre>');
});

test('ссылки: текст и адрес, опасные схемы превращаются в текст', () => {
  assert.equal(
    renderMarkdownPreview('[Пример](https://example.com)'),
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">Пример</a></p>'
  );
  // Внутри адреса кавычка уже экранирована вместе со всем входом (&quot;), а
  // повторное экранирование не даёт `&` превратиться в начале сущности обратно
  // в атрибут-разрыв — итог остаётся одной строкой в href.
  assert.equal(
    renderMarkdownPreview('[x](https://a.com/"onmouseover="alert(1))'),
    '<p><a href="https://a.com/&amp;quot;onmouseover=&amp;quot;alert(1)" target="_blank" rel="noopener noreferrer nofollow">x</a></p>'
  );
  // Главное: сырой `"` в href не попадает ни разу.
  assert.equal(renderMarkdownPreview('[x](https://a.com/"onmouseover="alert(1))').includes('""'), false);
});

test('подчёркивания и знак плюса в тексте не превращаются в разметку', () => {
  assert.equal(renderMarkdownPreview('a + b'), '<p>a + b</p>');
  assert.equal(renderMarkdownPreview('2 * 3 = 6'), '<p>2 * 3 = 6</p>');
});

test('javascript:-ссылка не становится ссылкой', () => {
  const html = renderMarkdownPreview('[клик](javascript:alert(1))');
  assert.equal(html.includes('<a '), false);
  assert.equal(html.includes('href'), false);
  assert.equal(html, '<p>[клик](javascript:alert(1))</p>');
});

test('цитаты', () => {
  assert.equal(renderMarkdownPreview('> цитата'), '<blockquote>цитата</blockquote>');
  assert.equal(
    renderMarkdownPreview('> первая\n> вторая'),
    '<blockquote>первая<br>вторая</blockquote>'
  );
});

test('горизонтальная линия', () => {
  assert.equal(renderMarkdownPreview('---'), '<hr>');
  assert.equal(renderMarkdownPreview('***'), '<hr>');
});

test('пустой вход — пустая строка, а не пустой абзац', () => {
  assert.equal(renderMarkdownPreview(''), '');
  assert.equal(renderMarkdownPreview('   \n\n  '), '');
  assert.equal(renderMarkdownPreview(null), '');
  assert.equal(renderMarkdownPreview(undefined), '');
});

test('вложенная разметка внутри списка и цитаты сохраняется', () => {
  assert.equal(
    renderMarkdownPreview('- **а** и `б`'),
    '<ul><li><strong>а</strong> и <code>б</code></li></ul>'
  );
});

// ────────────────────────────────────────────────────────────── безопасность

/** Единственная гарантия: в выходе нет ни одного сырого `<` из ввода. */
function assertNoRawTag(html) {
  // Разрешённые теги — ровно те, что генерирует рендерер.
  const allowed = /^(?:h1|h2|h3|p|br|ul|ol|li|strong|em|code|pre|a|blockquote|hr)$/;
  const tags = html.match(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g) ?? [];
  for (const tag of tags) {
    const name = tag.replace(/^<\/?/, '').toLowerCase();
    assert.ok(allowed.test(name), `неожиданный тег <${name}> в выводе`);
  }
}

test('XSS: <script> из ввода остаётся текстом', () => {
  const html = renderMarkdownPreview('<script>alert(1)</script>');
  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(html.includes('<script'), false);
  assertNoRawTag(html);
});

test('XSS: <img onerror> из ввода остаётся текстом', () => {
  const html = renderMarkdownPreview('<img src=x onerror=alert(1)>');
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('onerror='), true); // текст, но не атрибут
  assertNoRawTag(html);
});

test('XSS: разметка внутри markdown-конструкций тоже экранируется', () => {
  const cases = [
    '# <script>alert(1)</script>',
    '- <img src=x onerror=alert(1)>',
    '> <iframe src="javascript:alert(1)"></iframe>',
    '**<svg onload=alert(1)>**',
    '`<script>alert(1)</script>`',
    '```\n<script>alert(1)</script>\n```',
    '[<b>x</b>](https://example.com)',
    'абзац <div onmouseover="alert(1)">текст</div>',
  ];
  for (const markdown of cases) {
    const html = renderMarkdownPreview(markdown);
    assert.equal(html.includes('<script'), false, markdown);
    assert.equal(html.includes('<img'), false, markdown);
    assert.equal(html.includes('<iframe'), false, markdown);
    assert.equal(html.includes('<svg'), false, markdown);
    assert.equal(html.includes('onload='), html.includes('&lt;svg'), markdown);
    assertNoRawTag(html);
  }
});

test('XSS: инлайн-code не даёт пробить разметку обратными кавычками', () => {
  const html = renderMarkdownPreview('`</code><script>alert(1)</script>`');
  assert.equal(html.includes('<script'), false);
  assertNoRawTag(html);
});

test('XSS: амперсанд не съедает уже экранированные сущности', () => {
  // Двойное экранирование -> &amp;lt; это безопасно (текст), главное не сырой <.
  const html = renderMarkdownPreview('<b>');
  assert.equal(html, '<p>&lt;b&gt;</p>');
});
