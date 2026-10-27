/**
 * Осторожное деление на предложения для лаборатории и клиентских фрагментов.
 * Серверный парсер — источник истины для книг; здесь правило нужно, чтобы
 * прототип страницы вёл себя как настоящая глава.
 */

const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.', 'vs.', 'etc.',
  'e.g.', 'i.e.', 'a.m.', 'p.m.', 'no.', 'fig.', 'vol.', 'ch.',
]);

const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»']);

export function splitIntoSentences(text: string): string[] {
  const value = text.replace(/\s+/g, ' ').trim();
  if (!value) return [];

  const result: string[] = [];
  let start = 0;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (!'.!?…'.includes(char)) continue;

    let end = i + 1;
    while (end < value.length && CLOSERS.has(value[end])) end++;

    // Точка после инициала, сокращения или десятичного числа — не конец.
    if (char === '.') {
      const before = value.slice(start, i + 1).trim().toLowerCase();
      const lastWord = before.split(/\s+/).pop() ?? '';
      if (ABBREVIATIONS.has(lastWord)) continue;
      if (/\b[a-z]\.$/i.test(before) && i + 1 < value.length) continue;
      if (/\d\.\d/.test(value.slice(Math.max(0, i - 1), i + 2))) continue;
    }

    // Нужен пробел после знака (или конец текста), иначе это 3.14 или U.S.A.
    if (end < value.length && !/\s/.test(value[end])) continue;

    const sentence = value.slice(start, end).trim();
    if (sentence) result.push(sentence);
    start = end;
    while (start < value.length && /\s/.test(value[start])) start++;
  }

  const tail = value.slice(start).trim();
  if (tail) result.push(tail);

  return result.length > 0 ? result : [value];
}
