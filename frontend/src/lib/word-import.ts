/*
 * Массовый импорт слов из CSV/JSON — без React.
 *
 * Здесь всё, что можно проверить без браузера и без бэкенда: адрес ручки,
 * проверка файла до отправки, разбор ответа с номерами строк, человеческая
 * сводка и перевод HTTP-ошибок в понятный текст.
 *
 * Почему это отдельный файл, а не код внутри модалки:
 *  - проверка размера ДО отправки должна совпадать по формулировке с ответом
 *    сервера на 413. Две разные фразы про один лимит — это два разных
 *    вопроса админа к разработчику;
 *  - номера строк (`line`) — единственное, зачем админ смотрит в ответ. Потеря
 *    номера при разборе превращает «ошибка в строке 4» в «где-то ошибка», и
 *    файл на 800 слов становится неразбираемым;
 *  - ответ сервера может быть битым (не JSON, без полей). Импорт — операция с
 *    записью, поэтому разбор обязан не падать: упавший разбор после успешного
 *    импорта выглядит как «ничего не сработало».
 *
 * Файл не тянет React: его импортируют и клиентский компонент, и .mjs-тест
 * через `node --test`. Поэтому импорты в тестах — с расширением `.ts`.
 */

import { plural } from './plural.ts';

// ─────────────────────────────────────────────────────────────── ограничения

/** Лимит размера файла. Совпадает с ограничением бэкенда (413 больше 5 МБ). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Поддерживаемые расширения. Значение — для подсказки в интерфейсе. */
export const IMPORT_EXTENSIONS = ['.csv', '.json'] as const;

export type ImportFileKind = 'csv' | 'json';

/**
 * Сколько ошибок и предупреждений показывать в панели.
 *
 * Файл на тысячу строк с систематической ошибкой даёт тысячу одинаковых
 * записей: список превращается в бесконечную прокрутку, в которой не видно
 * ни сводки, ни кнопок. Обрезаем, но честно говорим об этом в `truncated`.
 */
export const MAX_LISTED_ISSUES = 50;

// ─────────────────────────────────────────────────────────────────── адреса

/**
 * Адрес ручки импорта для категории.
 *
 * Путь идёт БЕЗ префикса прокси: `/api/next` допишет toProxyUrl. Записать
 * здесь `/api/next/admin/...` — получить `/api/next/api/admin/...` → 404.
 * Query `dryRun` всегда присутствует: сухой прогон и запись различаются
 * только им, и адрес без него бэкенд может понять как удобно.
 *
 * Битый id — исключение, а не `/categories/null/...`: иначе клик по «Проверить»
 * уходит в 404 и выглядит как «импорт сломан».
 */
export function importRequestPath(categoryId: number, dryRun: boolean): string {
  if (typeof categoryId !== 'number' || !Number.isInteger(categoryId) || categoryId <= 0) {
    throw new Error('Не выбрана категория для импорта.');
  }
  return `/api/admin/content/categories/${categoryId}/words/import?dryRun=${dryRun ? 'true' : 'false'}`;
}

// ─────────────────────────────────────────────────── проверка файла до отправки

/** То, что нужно валидатору от File. Отдельный тип — чтобы тест не строил File. */
export interface ImportFileCandidate {
  name: string;
  size?: number;
}

export interface ImportFileCheck {
  /** Можно ли отправлять файл. */
  ok: boolean;
  /** Тип файла, если он распознан. При отказе — null. */
  kind: ImportFileKind | null;
  /** Готовый текст для показа под полем выбора. null — показывать нечего. */
  message: string | null;
}

function reject(message: string): ImportFileCheck {
  return { ok: false, kind: null, message };
}

/**
 * Проверка выбранного файла по имени и размеру — ДО отправки.
 *
 * Порядок проверок важен: сначала «файл выбран», потом расширение, потом
 * размер. Файл на 20 МБ с расширением .txt — это не «слишком большой файл»,
 * а «не тот файл», и совет должен совпадать с причиной.
 */
export function validateImportFile(file: ImportFileCandidate | null | undefined): ImportFileCheck {
  if (!file || typeof file.name !== 'string' || !file.name) {
    return reject('Выберите файл .csv или .json.');
  }

  const lower = file.name.trim().toLowerCase();
  // По хвосту имени, а не по вхождению: «words.csvx» — не CSV.
  const kind: ImportFileKind | null = lower.endsWith('.csv')
    ? 'csv'
    : lower.endsWith('.json')
      ? 'json'
      : null;

  if (!kind) {
    return reject('Нужен файл .csv или .json — другие форматы импорт не читает.');
  }

  // size может отсутствовать (тест, странный браузер). Тогда пропускаем
  // проверку размера: сервер всё равно ответит 413, и это будет понятный текст.
  const size = typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : null;
  if (size !== null) {
    if (size <= 0) {
      return reject('Файл пустой — в нём нет слов для импорта.');
    }
    if (size > MAX_IMPORT_BYTES) {
      // Формулировка совпадает с ответом сервера на 413 (describeImportHttpError).
      return reject('файл больше 5 МБ');
    }
  }

  return { ok: true, kind, message: null };
}

// ─────────────────────────────────────────────────────────────── разбор ответа

/** Одна ошибка или предупреждение. `line` — номер строки файла или поля JSON. */
export interface ImportIssue {
  line: number | null;
  message: string;
}

export interface ImportResult {
  added: number;
  skipped: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Списки обрезаны до MAX_LISTED_ISSUES — остальное не показано. */
  truncated: boolean;
}

/** Неотрицательное целое из ответа. Дробное — вниз, мусор — 0. */
function asCount(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  const value = Math.floor(raw);
  return value > 0 ? value : 0;
}

/**
 * Номер строки. Строка с цифрами принимается: сериализаторы иногда отдают
 * `"7"`. Ноль и отрицательные сохраняются как есть — это данные сервера, и
 * подменять их на «нет номера» значит скрыть, что бэкенд считает строки не с 1.
 */
function asLine(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return null;
}

/**
 * Список ошибок/предупреждений из ответа.
 *
 * Строка вместо объекта сохраняется как `{line: null, message}`: потерять текст
 * («файл пустой») хуже, чем потерять номер строки, которого в строке и не было.
 * Объект без message остаётся с пустым текстом — выдумывать формулировку за
 * сервер нельзя, но и выкидывать запись с номером строки тоже: админ увидит
 * «строка 5: —» и поймёт, что сервер промолчал.
 */
function asIssues(raw: unknown): ImportIssue[] {
  if (!Array.isArray(raw)) return [];

  const issues: ImportIssue[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const message = entry.trim();
      if (message) issues.push({ line: null, message });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;

    const row = entry as Record<string, unknown>;
    const messageRaw = row.message ?? row.error ?? row.detail;
    const message = typeof messageRaw === 'string' ? messageRaw.trim() : '';
    const line = asLine(row.line ?? row.lineNumber ?? row.row);

    // Полностью пустая запись — мусор без содержания.
    if (!message && line === null) continue;
    issues.push({ line, message });
  }

  return issues;
}

/**
 * Ответ ручки импорта → данные для панели.
 *
 * Битый ответ (null, строка, пустой объект) даёт нули и пустые списки: импорт
 * мог сработать, и падение разбора выглядело бы как его отказ.
 */
export function readImportResponse(raw: unknown): ImportResult {
  const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;

  const errors = asIssues(body.errors);
  const warnings = asIssues(body.warnings);

  return {
    added: asCount(body.added),
    skipped: asCount(body.skipped),
    errors: errors.slice(0, MAX_LISTED_ISSUES),
    warnings: warnings.slice(0, MAX_LISTED_ISSUES),
    truncated: errors.length > MAX_LISTED_ISSUES || warnings.length > MAX_LISTED_ISSUES,
  };
}

/** Есть ли что показать в списке проблем. */
export function hasImportErrors(result: Pick<ImportResult, 'errors' | 'warnings'>): boolean {
  return result.errors.length > 0 || result.warnings.length > 0;
}

// ─────────────────────────────────────────────────────────────────── сводка

/** Русская форма для счётчика слов: «слово / слова / слов». */
const words = (n: number): string => plural(n, ['слово', 'слова', 'слов']);

/**
 * «в 1 строке / в 2 строках / в 5 строках» — предложный падеж.
 *
 * `plural(n, ['строка', 'строки', 'строк'])` здесь дал бы «в 1 строка» и
 * «в 2 строки»: после предлога падеж другой, и таблица форм должна это
 * учитывать. «в» вынесена наружу — так видно, что она общая для всех форм.
 */
const linesIn = (n: number): string =>
  `в ${plural(n, ['1 строке', `${n} строках`, `${n} строках`])}`;

/**
 * Человеческая сводка результата.
 *
 * Сухой прогон говорит «Добавлено N, пропущено M» — это прогноз, ничего не
 * записано. Настоящий импорт говорит «Импортировано», иначе админ, увидев ту же
 * фразу, не поймёт, сработало ли на этот раз.
 *
 * Слово «ничего записано не будет» стоит только у сухого прогона. Для
 * настоящего импорта с ошибками это было бы ложью.
 */
export function formatImportSummary(
  result: Pick<ImportResult, 'added' | 'skipped' | 'errors' | 'warnings'>,
  options: { dryRun: boolean }
): string {
  const parts: string[] = [];

  const added = asCount(result.added);
  const skipped = asCount(result.skipped);

  parts.push(
    options.dryRun
      ? `Добавлено ${added} ${words(added)}, пропущено ${skipped}`
      : `Импортировано ${added} ${words(added)}. Пропущено ${skipped}`
  );

  const errorCount = result.errors.length;
  if (errorCount > 0) {
    parts.push(
      options.dryRun
        ? `Ошибки ${linesIn(errorCount)}: при настоящем импорте эти строки будут пропущены`
        : `Ошибка ${linesIn(errorCount)}`
    );
  }

  const warningCount = result.warnings.length;
  if (warningCount > 0) {
    parts.push(`${warningCount} ${plural(warningCount, ['предупреждение', 'предупреждения', 'предупреждений'])}`);
  }

  return parts.join('. ').replace(/\.\./g, '.');
}

// ─────────────────────────────────────────────────────────────── HTTP-ошибки

/**
 * Текст из тела ProblemDetails: message → title → error → detail.
 *
 * `error` стоит ВЫШЕ `detail`, и это не произвол: контроллер импорта кладёт
 * объяснение именно в `error` («Не удалось прочитать файл: …»), а в `detail`
 * на 409 приходит `ex.InnerException.Message` — текст исключения БД для
 * разработчика. Показать админу первым делом такое сообщение — значит
 * отправить его искать Stack Overflow вместо того, чтобы починить файл.
 * Если `error` не содержит ничего осмысленного, `detail` подхватится.
 */
export function parseImportErrorBody(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const value = raw.trim();
    return value ? value : null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const body = raw as Record<string, unknown>;
  for (const key of ['message', 'title', 'error', 'detail'] as const) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * HTTP-ответ с ошибкой → фраза для админа.
 *
 * Каждый частый код объясняется действием, а не кодом: админ видит этот экран
 * редко и не помнит, что значит 413. Текст из тела подклеивается как причина —
 * сервер знает, чем именно не понравился файл.
 */
export function describeImportHttpError(input: { status: number; body: unknown }): string {
  const status = typeof input.status === 'number' ? input.status : 0;
  const detail = parseImportErrorBody(input.body);

  switch (status) {
    case 413:
      // Точная формулировка совпадает с проверкой файла до отправки.
      return 'файл больше 5 МБ';
    case 409: {
      // Сервер сам пишет по-русски, что конфликт и что ничего не записано.
      // Его текст точнее нашего: он знает, с чем именно конфликт. Не выдаём
      // наружу `detail` (текст исключения БД) — он не для админа.
      return detail && !/^conflict$/i.test(detail)
        ? detail
        : 'Конфликт: часть слов пересекается с существующими — ничего не записано.';
    }
    case 400:
      return detail ?? 'Сервер не принял файл: проверьте формат (CSV с колонками или JSON-массив).';
    case 404:
      return 'Категория не найдена — возможно, её удалили. Обновите страницу и выберите другую.';
    case 401:
    case 403:
      return 'Нужны права администратора: импорт доступен только роли Admin.';
    default:
      return detail ?? `Импорт не выполнен: сервер ответил ${status || 'без кода'}.`;
  }
}
