/**
 * Атрибуция канала (W2.1).
 *
 * Ссылки для беты рассылаются с метками: `?ref=<код>` — личная ссылка учителя или
 * канала, `?utm_source|utm_medium|utm_content` — пост в VK/Дзен/Product Radar.
 * Человек обычно регистрируется не в том же окне, где пришёл (открыл, ушёл,
 * вернулся через пару дней), поэтому метки сохраняются в cookie на 30 дней и
 * передаются в теле `/api/auth/register`.
 *
 * Модель — first touch: запись, которая уже лежит и не истекла, не заменяется.
 * Коды нормализуются так же, как на бэкенде (AcquisitionNormalizer): строчные
 * латинские буквы, цифры и дефис, не длиннее 64 символов. Фронтенд — не место,
 * где это «последняя инстанция», но чистить значение здесь нужно, чтобы в cookie
 * не попадало что угодно из URL.
 */

export const ATTRIBUTION_COOKIE_NAME = 'lex_attr';
export const ATTRIBUTION_STORAGE_KEY = 'lex_attr';
export const ATTRIBUTION_TTL_DAYS = 30;
export const MAX_CODE_LENGTH = 64;

export interface Attribution {
  /** Личный код канала из `?ref=` */
  ref: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmContent: string | null;
  /** Когда метки были пойманы (epoch ms) — по нему считается срок годности */
  capturedAt: number;
}

/** Сырые метки из URL, ещё без нормализации. */
export interface RawAttributionParams {
  ref: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmContent: string | null;
}

const EMPTY_PARAMS: RawAttributionParams = {
  ref: null,
  utmSource: null,
  utmMedium: null,
  utmContent: null,
};

/**
 * Slug на алфавите [a-z0-9-]: любой посторонний символ становится дефисом,
 * двойные и обрамляющие дефисы снимаются, длина ограничивается колонкой БД.
 * Пустое значение — null, а не пустая строка: «нет источника» должно
 * отличаться от «источник — пустая строка».
 */
export function normalizeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let out = '';
  let pendingSeparator = false;

  for (const ch of raw.trim().toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) {
      if (pendingSeparator && out.length > 0) out += '-';
      pendingSeparator = false;
      out += ch;
    } else {
      pendingSeparator = out.length > 0;
    }
  }

  if (out.length === 0) return null;

  out = out.slice(0, MAX_CODE_LENGTH);
  while (out.endsWith('-')) out = out.slice(0, -1);

  return out.length === 0 ? null : out;
}

/** Разбирает `?ref=` и utm-метки из search-строки: подходит и '?a=1&b=2', и 'a=1&b=2'. */
export function parseAttributionParams(search: string): RawAttributionParams {
  if (!search) return EMPTY_PARAMS;

  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return {
      ref: params.get('ref'),
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmContent: params.get('utm_content'),
    };
  } catch {
    // Скривлёный query не должен ронять страницу: считаем, что меток нет
    return EMPTY_PARAMS;
  }
}

export function hasAnyParam(params: RawAttributionParams): boolean {
  return Boolean(params.ref || params.utmSource || params.utmMedium || params.utmContent);
}

/**
 * Собирает запись атрибуции из меток URL. Возвращает null, если ловить нечего
 * (например, `?ref=привет` — после нормализации от кода ничего не осталось).
 */
export function fromParams(params: RawAttributionParams, capturedAt: number): Attribution | null {
  const record: Attribution = {
    ref: normalizeCode(params.ref),
    utmSource: normalizeCode(params.utmSource),
    utmMedium: normalizeCode(params.utmMedium),
    utmContent: normalizeCode(params.utmContent),
    capturedAt,
  };

  if (!record.ref && !record.utmSource && !record.utmMedium && !record.utmContent) return null;
  return record;
}

/**
 * Ядро: уже сохранённая и не истёкшая запись важнее новых меток (first touch).
 * Если сохранённая истекла — считаем её отсутствующей и берём новые метки.
 */
export function resolveAttribution(
  stored: Attribution | null,
  params: RawAttributionParams,
  now: number,
  ttlDays: number = ATTRIBUTION_TTL_DAYS
): Attribution | null {
  if (stored && !isExpired(stored, now, ttlDays)) return stored;

  return fromParams(params, now);
}

export function isExpired(
  record: Attribution,
  now: number,
  ttlDays: number = ATTRIBUTION_TTL_DAYS
): boolean {
  if (!Number.isFinite(record.capturedAt)) return true;
  return now - record.capturedAt > ttlDays * 24 * 60 * 60 * 1000;
}

/**
 * Хранимое значение — компактная строка `ref|source|medium|content|capturedAt`.
 * Разделитель выбран намеренно: нормализованные коды его содержать не могут,
 * поэтому парсить безопасно и JSON-декодирование в cookie не нужно.
 */
export function serialize(record: Attribution): string {
  return [
    record.ref ?? '',
    record.utmSource ?? '',
    record.utmMedium ?? '',
    record.utmContent ?? '',
    String(record.capturedAt),
  ].join('|');
}

export function deserialize(value: string | null | undefined): Attribution | null {
  if (!value) return null;

  const parts = value.split('|');
  if (parts.length !== 5) return null;

  const capturedAt = Number(parts[4]);
  if (!Number.isFinite(capturedAt)) return null;

  return {
    ref: parts[0] ? parts[0] : null,
    utmSource: parts[1] ? parts[1] : null,
    utmMedium: parts[2] ? parts[2] : null,
    utmContent: parts[3] ? parts[3] : null,
    capturedAt,
  };
}

export function readCookie(name: string, cookie: string): string | null {
  if (!cookie) return null;

  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }

  return null;
}

/** Читает сохранённую атрибуцию: cookie (переживает перезапуск браузера), затем sessionStorage. */
export function readStored(
  cookie: string,
  storage?: { getItem(key: string): string | null } | null
): Attribution | null {
  const fromCookie = deserialize(readCookie(ATTRIBUTION_COOKIE_NAME, cookie));
  if (fromCookie) return fromCookie;

  try {
    return deserialize(storage?.getItem(ATTRIBUTION_STORAGE_KEY) ?? null);
  } catch {
    // Приватный режим Firefox бросает на доступ к sessionStorage
    return null;
  }
}

/**
 * Действующая атрибуция для отправки при регистрации: сохранённая запись,
 * но не старше окна в 30 дней. Истёкшую не шлём — «пришёл месяц назад по
 * ссылке» уже не то же самое, что «пришёл сейчас».
 */
export function getActiveAttribution(
  cookie: string,
  storage?: { getItem(key: string): string | null } | null,
  now: number = Date.now(),
  ttlDays: number = ATTRIBUTION_TTL_DAYS
): Attribution | null {
  const stored = readStored(cookie, storage);
  if (!stored) return null;
  return isExpired(stored, now, ttlDays) ? null : stored;
}

/**
 * Ловит метки текущего URL и сохраняет их, если своей записи ещё нет.
 * Возвращает действующую атрибуцию (или null). Никогда не бросает: атрибуция
 * не должна ломать страницу.
 */
export function capture(
  search: string,
  cookie: string,
  storage: { setItem(key: string, value: string): void; getItem(key: string): string | null } | null,
  now: number,
  ttlDays: number = ATTRIBUTION_TTL_DAYS,
  writeCookie: (name: string, value: string, maxAgeSeconds: number) => void = () => {}
): Attribution | null {
  const stored = readStored(cookie, storage);
  const next = resolveAttribution(stored, parseAttributionParams(search), now, ttlDays);

  if (!next || next === stored) return next;

  const value = serialize(next);
  const maxAgeSeconds = Math.floor(ttlDays * 24 * 60 * 60);

  writeCookie(ATTRIBUTION_COOKIE_NAME, encodeURIComponent(value), maxAgeSeconds);

  try {
    storage?.setItem(ATTRIBUTION_STORAGE_KEY, value);
  } catch {
    // Без sessionStorage атрибуция доживёт только до закрытия вкладки — не критично
  }

  return next;
}

/**
 * Поля для тела `/api/auth/register`. Пустые метки не отправляем: сервер
 * различает «не пришли» и «пришли пустые», и лишние null в JSON не нужны.
 */
export function registrationPayload(
  record: Attribution | null
): Partial<RawAttributionParams> {
  if (!record) return {};

  const payload: Partial<RawAttributionParams> = {};
  if (record.ref) payload.ref = record.ref;
  if (record.utmSource) payload.utmSource = record.utmSource;
  if (record.utmMedium) payload.utmMedium = record.utmMedium;
  if (record.utmContent) payload.utmContent = record.utmContent;

  return payload;
}
