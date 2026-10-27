const NBSP = '\u00A0';

/**
 * Разряды через неразрывный пробел. toLocaleString('ru-RU') в Node отдаёт
 * U+00A0, а браузерный ICU — узкий U+202F: сервер и клиент рисуют одно число
 * разными символами, и гидратация спорит. Здесь один детерминированный пробел.
 */
export function formatNumber(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}
