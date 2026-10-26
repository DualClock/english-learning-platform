/**
 * Имя пользователя — одно правило на весь интерфейс.
 *
 * Имя в онбординге необязательное, поэтому `User.DisplayName` регулярно
 * приходит `null`, а бэкенд хранит `UserName = email`. Раньше каждый экран
 * решал это по-своему через `email.split('@')[0]`, и в приветствии
 * появлялось «Доброй ночи, audit-1793045167713» — технический идентификатор
 * на самом видном месте.
 *
 * Правило здесь одно: на экран попадает только человеческое имя. Если его
 * нет — подставляется запасное, но никогда не email, не локаль и не id.
 */

/** Запасное имя, когда человек не назвался. */
export const FALLBACK_NAME = 'друг';

/**
 * Годится ли значение как имя: непустое и не похоже на адрес почты.
 *
 * Проверка на «собаку» — второй рубеж. Первый рубеж — не передавать email
 * туда, где ожидается имя, но защита не должна зависеть от аккуратности
 * вызывающего кода.
 */
export function isUsableName(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes('@')) return false;
  return true;
}

/**
 * Имя для показа. `null`, пустая строка, пробелы и email дают запасное имя.
 */
export function displayNameOf(value: string | null | undefined): string {
  return isUsableName(value) ? (value as string).trim() : FALLBACK_NAME;
}
