/**
 * Сравнение ответов «на слух»: нормализация, пословный diff и точность.
 * Используется диктантом и проверкой произношения.
 */

/** Нижний регистр, без пунктуации, схлопнутые пробелы. */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeAnswer(text);
  return normalized ? normalized.split(' ') : [];
}

export interface WordMatch {
  word: string;
  ok: boolean;
}

/**
 * Пословное сравнение: слова выравниваются по позиции, лишние слова
 * попытки помечаются как ошибочные. Для диктанта этого достаточно,
 * а простота важнее «умного» выравнивания.
 */
export function compareWords(target: string, attempt: string): WordMatch[] {
  const targetTokens = tokenize(target);
  const attemptTokens = tokenize(attempt);

  return targetTokens.map((word, index) => ({
    word,
    ok: attemptTokens[index] === word,
  }));
}

/** Точность 0–100 по совпавшим на своих местах словам. */
export function accuracyPercent(target: string, attempt: string): number {
  const matches = compareWords(target, attempt);
  if (matches.length === 0) return 0;
  const ok = matches.filter((m) => m.ok).length;
  return Math.round((ok / matches.length) * 100);
}

/** Расстояние Левенштейна — для проверки произношения по словам. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }

  return previous[b.length];
}

/** Похожесть строк 0–100 на основе расстояния Левенштейна. */
export function similarityPercent(a: string, b: string): number {
  const left = normalizeAnswer(a);
  const right = normalizeAnswer(b);
  if (!left && !right) return 100;
  const max = Math.max(left.length, right.length);
  if (max === 0) return 100;
  return Math.round((1 - levenshtein(left, right) / max) * 100);
}
