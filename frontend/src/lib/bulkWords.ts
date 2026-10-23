export const BULK_WORD_LIMIT = 50;
export const BULK_WORD_MAX_LENGTH = 100;

const ENGLISH_RE = /^[a-zA-Z\s'-]+$/;

export interface InvalidBulkWord {
  value: string;
  reason: string;
}

export interface BulkWordPreview {
  valid: string[];
  duplicates: string[];
  invalid: InvalidBulkWord[];
  emptyCount: number;
  exceedsLimit: boolean;
}

/**
 * Разбор пачки из textarea: запятая и перенос строки — разделители.
 * Пустые куски не считаем ошибкой, повторы и не-английские токены
 * показываем отдельно, чтобы человек видел, что именно не добавится.
 */
export function parseBulkWords(input: string): BulkWordPreview {
  const pieces = input.split(/,|\n/);
  const valid: string[] = [];
  const duplicates: string[] = [];
  const invalid: InvalidBulkWord[] = [];
  const seen = new Set<string>();
  let emptyCount = 0;

  for (const piece of pieces) {
    const value = piece.trim().replace(/\s+/g, ' ');

    if (!value) {
      emptyCount++;
      continue;
    }

    if (value.length > BULK_WORD_MAX_LENGTH) {
      invalid.push({ value, reason: `длиннее ${BULK_WORD_MAX_LENGTH} символов` });
      continue;
    }

    if (!ENGLISH_RE.test(value)) {
      invalid.push({ value, reason: 'не английский текст' });
      continue;
    }

    const key = value.toLocaleLowerCase('en');
    if (seen.has(key)) {
      duplicates.push(value);
      continue;
    }

    seen.add(key);
    valid.push(value);
  }

  return {
    valid,
    duplicates,
    invalid,
    emptyCount,
    exceedsLimit: valid.length > BULK_WORD_LIMIT,
  };
}
