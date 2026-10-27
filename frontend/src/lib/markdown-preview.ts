/*
 * Предпросмотр markdown для формы статьи — на клиенте.
 *
 * Зачем свой рендерер. Сервер присылает готовый безопасный HTML, но только для
 * СОХРАНЁННЫХ статей: в форме живёт ещё не сохранённый текст, и показать его
 * читателю можно только собрав HTML здесь. Отдельная задача этого модуля — не
 * повторить историю «богатого» парсера: тот же экран админки выполняет
 * dangerouslySetInnerHTML, поэтому единственная надёжная гарантия — экранировать
 * ВЕСЬ вход ДО наложения разметки. Сырой `<` из ввода физически не попадает в
 * результат: он превращается в `&lt;` на первом шаге, и накладывать разметку
 * можно только на уже безопасный текст.
 *
 * Возможности намеренно узкие — ровно то, что пишут в статьях:
 * заголовки решётками, маркированные и нумерованные списки, жирный и курсив,
 * инлайн-код, fenced-блоки, ссылки, цитаты, горизонтальная линия и абзацы.
 *
 * Файл не тянет React: его импортирует и клиентский компонент, и .mjs-тест
 * через `node --test`.
 */

// ─────────────────────────────────────────────────────── экранирование

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Экранирует всё, что может открыть тег или атрибут. Плюс не трогаем: это не
 * часть HTML-синтаксиса, и превращать `a + b` в `a%20b` незачем.
 */
export function escapeHtml(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

// ─────────────────────────────────────────────────────────────── ссылки

/** Схема адреса, которую пускаем: только явно безопасные. */
const SAFE_SCHEME = /^(?:https?|mailto):/i;

/**
 * Адрес для href. Относительные пути и якоря допустимы, всё остальное с
 * двоеточием — нет: `javascript:` и `data:` в ссылке статьи не нужны никогда.
 *
 * Сравнение идёт по схеме без пробелов, табов и NUL внутри — браузер их
 * игнорирует при разборе, и `java\tscript:` сработал бы как `javascript:`.
 */
export function safeHref(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value) return '';
  // Схема есть только если двоеточие до первого /, ? или #.
  const colon = value.search(/[:/?#]/);
  if (colon >= 0 && value[colon] === ':') {
    const scheme = value.slice(0, colon).replace(/[\s\u0000-\u001f]/g, '');
    return SAFE_SCHEME.test(`${scheme}:`) ? value : '';
  }
  return value;
}

// ──────────────────────────────────────────────────────── инлайн-разметка

/**
 * Разметка внутри строки: код, жирный, курсив, ссылки.
 *
 * Порядок важен. Инлайн-код выносится в плейсхолдеры первым: внутри `кода`
 * звёздочки и скобки — это буквы, а не разметка. Плейсхолдер построен на
 * непечатных символах (U+E000+), которых в обычном тексте статьи не бывает и
 * которые не участвуют ни в одном шаблоне ниже.
 */
function renderInline(escaped: string): string {
  const codes: string[] = [];

  let text = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    const index = codes.push(`<code>${code.trim()}</code>`) - 1;
    return `\uE000${index}\uE001`;
  });

  // Ссылки — до жирного и курсива: в тексте ссылки разметка тоже живая, но
  // скобки и звёздочки внутри адреса не должны рвать шаблон адреса.
  text = text.replace(/\[([^\]]+)\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)*)\)/g, (match, label: string, href: string) => {
    const url = safeHref(href);
    // Опасная схема — оставляем как набрано, но ссылкой не делаем.
    if (!url) return match;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
  });

  // Жирное собирается по содержимому звёздочек ПОСЛЕ курсива: так `**a *b* c**`
  // видит буквы и <em> внутри, а маркеры курсива уже израсходованы.
  // Подчёркивания — частный случай, но пары в них не вложенные, порядок не важен.
  text = italic(text);
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

  return text.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => codes[Number(index)] ?? '');
}

/**
 * Курсив одиночными `*` или `_`.
 *
 * Регэкспом это не решается: `**жирное *курсив* внутри**` требует, чтобы внешняя
 * пара звёздочек не путалась с маркерами курсива. Проходим по строке вручную —
 * открытая пара запоминает маркер и ищет его же снова. Подчёркивание внутри
 * слова (snake_case) маркером не считается.
 */
function italic(text: string): string {
  let result = '';
  let open: { marker: string; at: number } | null = null;
  // Сдвиг индекса: открытый тег добавляет символы, и `text[i]` перестал бы
  // соответствовать позиции в результате — тогда «2 * 3» с двумя звёздочками
  // становился бы пустым <em></em>.
  let shift = 0;

  for (let i = 0; i < text.length; i += 1) {
    // Позиция текущего символа в результате: по ней и проверяем соседей.
    const index = i + shift;
    const char = text[i];
    const isMarker = char === '*' || char === '_';
    // Сосед по обе стороны от `_` — буква или цифра: это часть слова.
    const inWord =
      char === '_' &&
      /[\wА-Яа-яЁё]/.test(result[index - 1] ?? '') &&
      /[\wА-Яа-яЁё]/.test(text[i + 1] ?? '');

    if (!isMarker || inWord) {
      result += char;
      continue;
    }

    if (open && open.marker === char) {
      // Пустая пара (**): это маркеры жирного, а не курсив. Отдаём оба символа
      // как есть — `<strong>` соберётся следующим шагом.
      if (result.slice(open.at + '<em>'.length) === '') {
        result = `${result.slice(0, open.at)}${open.marker}${open.marker}`;
        shift += 1 - '<em>'.length;
        open = null;
        continue;
      }
      result += '</em>';
      shift += '</em>'.length - 1;
      open = null;
      continue;
    }

    if (open) {
      // Пара не закрылась — маркер был обычным символом. Возвращаем его и
      // начинаем пару заново с текущего.
      result += open.marker;
      open = { marker: char, at: index };
      result += '<em>';
      shift += open.marker.length - 1 + '<em>'.length - 1;
      continue;
    }

    // Открыть пару можно, только если дальше в строке есть тот же маркер:
    // иначе одиночная звёздочка в «2 * 3» осталась бы незакрытым <em>.
    if (text.indexOf(char, i + 1) === -1) {
      result += char;
      continue;
    }

    open = { marker: char, at: index };
    result += '<em>';
    shift += '<em>'.length - 1;
  }

  if (open) {
    // Не закрылось — откатываем открытый тег и вставляем маркер как есть.
    result = `${result.slice(0, open.at)}${open.marker}${result.slice(open.at + '<em>'.length)}`;
  }
  return result;
}

// ──────────────────────────────────────────────────────────────── блоки

/*
 * Шаблоны строк работают по УЖЕ ЭКРАНИРОВАННОМУ тексту, поэтому `>` в них
 * записан как `&gt;`, а `"` как `&quot;`. Писать здесь сырые символы — значит
 * молча терять каждый блок цитаты (его `>` к этому моменту уже превращён).
 */
const BULLET_ITEM = /^\s*[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*&gt;\s?(.*)$/;
const FENCE = /^\s*```(.*)$/;
const HORIZONTAL = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** Уровень заголовка: глубже третьего в статье не бывает, всё сводим к h3. */
function headingTag(level: number): 'h1' | 'h2' | 'h3' {
  if (level <= 1) return 'h1';
  if (level === 2) return 'h2';
  return 'h3';
}

/**
 * Markdown → HTML, безопасный для dangerouslySetInnerHTML.
 *
 * Вход сначала экранируется целиком; дальше шаблоны работают только по
 * безопасному тексту и добавляют только свои теги из фиксированного набора.
 */
export function renderMarkdownPreview(markdown: unknown): string {
  if (typeof markdown !== 'string' || !markdown.trim()) return '';

  const lines = escapeHtml(markdown.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];

  // Открытые блоки: список и цитата. Закрываются при смене типа строки.
  let list: 'ul' | 'ol' | null = null;
  let quote: string[] = [];
  let paragraph: string[] = [];

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const closeQuote = () => {
    if (quote.length) {
      out.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
      quote = [];
    }
  };
  const closeParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const closeAll = () => {
    closeParagraph();
    closeQuote();
    closeList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // ```-блок: тело дословно, без инлайн-разметки (оно уже экранировано).
    const fence = line.match(FENCE);
    if (fence) {
      closeAll();
      const language = fence[1].trim().replace(/[^\w+#-]/g, '');
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      // Закрывающая ``` — если она есть, цикл уже стоит на ней и for её пропустит.
      const className = language ? ` class="language-${language}"` : '';
      out.push(`<pre><code${className}>${body.join('\n')}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      closeAll();
      continue;
    }

    if (HORIZONTAL.test(line)) {
      closeAll();
      out.push('<hr>');
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      closeAll();
      const tag = headingTag(heading[1].length);
      out.push(`<${tag}>${renderInline(heading[2].trim())}</${tag}>`);
      continue;
    }

    const quoted = line.match(QUOTE);
    if (quoted) {
      closeParagraph();
      closeList();
      quote.push(renderInline(quoted[1]));
      continue;
    }

    const bullet = line.match(BULLET_ITEM);
    const ordered = bullet ? null : line.match(ORDERED_ITEM);
    if (bullet || ordered) {
      closeParagraph();
      closeQuote();
      const kind: 'ul' | 'ol' = bullet ? 'ul' : 'ol';
      if (list && list !== kind) closeList();
      if (!list) {
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${renderInline((bullet ? bullet[1] : ordered ? ordered[1] : '').trim())}</li>`);
      continue;
    }

    // Продолжение пункта списка: строка с отступом прилипает к последнему <li>.
    if (list && /^\s+\S/.test(line) && out.length > 0) {
      const last = out[out.length - 1];
      if (last.startsWith('<li>')) {
        out[out.length - 1] = `${last.slice(0, -'</li>'.length)} ${renderInline(line.trim())}</li>`;
        continue;
      }
    }

    closeList();
    closeQuote();
    paragraph.push(renderInline(line.trim()));
  }

  closeAll();
  return out.join('');
}
