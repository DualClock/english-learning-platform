/**
 * Тап по слову без тысяч span-обёрток: браузер сам говорит, какой символ
 * оказался под пальцем, а мы поднимаемся к предложению [data-s] и расширяем
 * смещение до границ слова. Так выключка и переносы остаются книжными.
 */

export interface PointWord {
  word: string;
  sentenceId: string;
  sentenceText: string;
  charOffset: number;
}

type CaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (
    x: number,
    y: number
  ) => { offsetNode: Node; offset: number } | null;
};

export function getCaretRange(x: number, y: number): Range | null {
  if (typeof document === 'undefined') return null;
  const doc = document as CaretDocument;

  if (typeof doc.caretRangeFromPoint === 'function') {
    return doc.caretRangeFromPoint(x, y);
  }

  if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(x, y);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  return null;
}

function sentenceElementFrom(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const element =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node instanceof HTMLElement
        ? node
        : null;
  return element?.closest<HTMLElement>('[data-s]') ?? null;
}

function wordAtOffset(text: string, offset: number): { word: string; start: number } | null {
  const matcher = /[A-Za-z][A-Za-z'’-]*/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) {
      const word = match[0].replace(/^[-'’-]+|[-'’-]+$/g, '');
      return word.length >= 2 ? { word, start } : null;
    }
  }

  return null;
}

export function wordAtPoint(x: number, y: number): PointWord | null {
  const range = getCaretRange(x, y);
  if (!range) return null;

  const sentence = sentenceElementFrom(range.startContainer);
  if (!sentence) return null;

  const text = sentence.textContent ?? '';
  const found = wordAtOffset(text, range.startOffset);
  if (!found) return null;

  const sentenceId = sentence.dataset.s;
  if (!sentenceId) return null;

  return {
    word: found.word,
    sentenceId,
    sentenceText: text,
    charOffset: found.start,
  };
}

/** Якорь первого видимого символа — запасной путь, если caret API недоступен. */
export function firstVisibleSentence(
  viewport: DOMRect,
  elements: ArrayLike<HTMLElement>
): { sentenceId: string; charOffset: number } | null {
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    const sentenceId = element.dataset.s;
    if (!sentenceId) continue;

    const rects = element.getClientRects();
    for (let rectIndex = 0; rectIndex < rects.length; rectIndex++) {
      const rect = rects.item(rectIndex);
      if (!rect) continue;

      const visible =
        rect.bottom > viewport.top + 1 &&
        rect.top < viewport.bottom - 1 &&
        rect.right > viewport.left + 1 &&
        rect.left < viewport.right - 1;
      if (visible) return { sentenceId, charOffset: 0 };
    }
  }

  return null;
}
