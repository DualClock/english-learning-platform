/**
 * Русская плюрализация: «1 слово / 2 слова / 5 слов».
 * Числительное впереди существительного, поэтому правило режет последнее
 * число, включая «свыше 20»: 15 слов, но 21 слово.
 */
export function plural(n: number, forms: [one: string, few: string, many: string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export function pluralWords(n: number): string {
  return plural(n, ['слово', 'слова', 'слов']);
}

export function pluralQuestions(n: number): string {
  return plural(n, ['вопрос', 'вопроса', 'вопросов']);
}

export function pluralSentences(n: number): string {
  return plural(n, ['предложение', 'предложения', 'предложений']);
}

export function pluralUnits(n: number): string {
  return plural(n, ['юнит', 'юнита', 'юнитов']);
}

export function pluralBooks(n: number): string {
  return plural(n, ['книга', 'книги', 'книг']);
}
