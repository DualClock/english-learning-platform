/**
 * Чистая математика постраничной читалки. Всё, что можно проверить без DOM,
 * живёт здесь: номера страниц, границы и якорь позиции. Движок в
 * usePaginator только измеряет браузер и вызывает эти функции.
 */

export interface ReaderAnchor {
  sentenceId: string;
  charOffset: number;
}

const EDGE_EPSILON = 1e-3;

export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 0;
  const total = Math.max(1, Math.floor(totalPages));
  return Math.min(total - 1, Math.max(0, Math.floor(page)));
}

/** Страница, в которой начинается символ с координатой left. */
export function pageIndexFromLeft(left: number, flowLeft: number, pageWidth: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(flowLeft) || pageWidth <= 0) return 0;
  return Math.max(0, Math.floor((left - flowLeft + EDGE_EPSILON) / pageWidth));
}

/** Сколько всего страниц, если последний символ текста стоит на lastLeft. */
export function pageCountFromLastLeft(lastLeft: number, flowLeft: number, pageWidth: number): number {
  if (!Number.isFinite(lastLeft) || !Number.isFinite(flowLeft) || pageWidth <= 0) return 1;
  return Math.max(1, pageIndexFromLeft(lastLeft, flowLeft, pageWidth) + 1);
}

/** Ограничивает смещение внутри предложения его длиной. */
export function clampCharOffset(offset: number, textLength: number): number {
  if (!Number.isFinite(offset) || textLength <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(offset)), Math.max(0, textLength - 1));
}

/** Приблизительная доля книги по прочитанным словам — без доверия клиенту. */
export function wordProgressPercent(wordsBefore: number, totalWords: number): number {
  if (!Number.isFinite(wordsBefore) || !Number.isFinite(totalWords) || totalWords <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((wordsBefore / totalWords) * 1000) / 10));
}
