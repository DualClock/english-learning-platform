/**
 * Склейка className без зависимостей: falsy-значения отбрасываем, остальное
 * соединяем пробелом. Полноценный tailwind-merge здесь не нужен — компонент
 * не собирается из конфликтующих вариантов одного и того же свойства.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
