/*
 * AI-ассистент статьи: чистая часть.
 *
 * В компоненте остаётся только отрисовка — всё, что решает «что отправить»,
 * «что показать после ответа» и «что сказать про ошибку», живёт здесь и
 * проверяется юнит-тестами. Причина: дневной лимит расходуется на каждый вызов,
 * и ошибка «отправили пустую тему» или «429 показали как ошибку сети» стоит
 * реальных вызовов и молчаливой потери кнопки.
 *
 * Файл не тянет React: его импортирует и панель в форме, и .mjs-тест.
 */

// ─────────────────────────────────────────────────────────── уровни и тема

/** Уровни, которые понимает ручка: ровно эти значения, без b1/B1-вариантов. */
export const ASSISTANT_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;

export type AssistantLevel = (typeof ASSISTANT_LEVELS)[number];

export interface ArticleDraftRequest {
  topic: string;
  level?: AssistantLevel;
  audience?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asLevel(value: unknown): AssistantLevel | null {
  const candidate = text(value).toUpperCase();
  return (ASSISTANT_LEVELS as readonly string[]).includes(candidate)
    ? (candidate as AssistantLevel)
    : null;
}

/**
 * Тело запроса POST /admin/assistant/article.
 *
 * null вместо пустого объекта: отправлять без темы нельзя — сервер ответит 400,
 * а вызов лимита уже спишется. Пустые level/audience не уезжают вовсе, иначе
 * сервер получил бы аудиторию `""` и счёл её значением.
 */
export function articleDraftRequest(input: {
  topic?: string | null;
  level?: string | null;
  audience?: string | null;
}): ArticleDraftRequest | null {
  const topic = text(input.topic);
  if (!topic) return null;

  const request: ArticleDraftRequest = { topic };
  const level = asLevel(input.level);
  if (level) request.level = level;

  const audience = text(input.audience);
  if (audience) request.audience = audience;

  return request;
}

// ─────────────────────────────────────────────────────────────── черновик

export interface ArticleDraft {
  title: string;
  bodyMarkdown: string;
}

/** Ответ ручки → черновик. Без заголовка или тела подставлять нечего. */
export function toArticleDraft(raw: unknown): ArticleDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const title = text(body.title);
  const bodyMarkdown = typeof body.bodyMarkdown === 'string' ? body.bodyMarkdown.trim() : '';
  if (!title || !bodyMarkdown) return null;
  return { title, bodyMarkdown };
}

/** Форма статьи (структурно совместима с ArticleFormState). */
export interface DraftTargetForm {
  title: string;
  slug: string;
  summary: string;
  sectionId: string | number | null | undefined;
  bodyMarkdown: string;
}

/**
 * Черновик поверх формы. Меняются только заголовок и тело: раздел, анонс и
 * руками введённый slug — решения админа, и ИИ не должен их затирать.
 */
export function articleDraftToForm<T extends DraftTargetForm>(
  form: T,
  draft: ArticleDraft
): T {
  return { ...form, title: draft.title, bodyMarkdown: draft.bodyMarkdown };
}

/**
 * Текст подтверждения замены. null — спрашивать не о чем: поле пустое и
 * генерация ничего не уничтожит.
 */
export function replaceConfirmMessage(bodyMarkdown: string | null | undefined): string | null {
  if (!text(bodyMarkdown)) return null;
  return 'В поле текста уже есть набранное. Заменить его черновиком от ассистента? Отменить это будет нельзя.';
}

// ─────────────────────────────────────────────────────────────── статус

export interface AssistantStatus {
  limit: number;
  used: number;
  remaining: number;
  /** Включён ли ассистент на бэкенде (ключ ИИ на месте). */
  enabled: boolean;
}

function nonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const floored = Math.floor(value);
  return floored >= 0 ? floored : null;
}

/**
 * Ответ GET /admin/assistant/status.
 *
 * Битый ответ не выключает ассистента: одна неудачная загрузка статуса не
 * должна отнимать у админа кнопку. А вот `enabled: false` и нулевой остаток
 * кнопку выключают — сервер отказал бы всё равно.
 */
export function normalizeAssistantStatus(raw: unknown): AssistantStatus {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const limit = nonNegativeInt(body.limit) ?? 0;
  const used = nonNegativeInt(body.used) ?? 0;
  const reported = nonNegativeInt(body.remaining);
  const computed = Math.max(limit - used, 0);

  return {
    limit,
    used,
    // Присланный остаток не может превышать лимит: подпись «17 из 10» — явная ложь.
    remaining: reported === null ? computed : Math.min(reported, limit || reported),
    enabled: body.enabled !== false,
  };
}

/** Кнопка генерации недоступна: выключено на сервере или лимит на нуле. */
export function isAssistantDisabled(status: AssistantStatus): boolean {
  return !status.enabled || status.remaining <= 0;
}

/** Подпись под кнопкой: остаток лимита или причина, почему кнопки нет. */
export function assistantStatusLabel(status: AssistantStatus): string {
  if (!status.enabled) {
    return 'Ассистент выключен администратором: на сервере нет ключа ИИ. Текст пока пишется руками.';
  }
  const limit = Math.max(status.limit, 0);
  if (limit === 0) return 'Ассистент недоступен: лимит вызовов не настроен.';
  const base = `Осталось ${status.remaining} из ${limit} вызовов сегодня`;
  // Ноль остатка — это не «просто подпись», а причина, почему кнопка мертва.
  return status.remaining === 0 ? `${base} — дневной лимит исчерпан, ждите завтра.` : base;
}

// ──────────────────────────────────────────────────────────────── ошибки

export type AssistantErrorKind = 'limit' | 'unavailable' | 'bad-request' | 'forbidden' | 'network' | 'unknown';

export interface AssistantError {
  kind: AssistantErrorKind;
  /** Готовый текст для плашки: из поля `error` ответа, иначе свой. */
  message: string;
}

const DEFAULT_BY_KIND: Record<AssistantErrorKind, string> = {
  limit: 'Дневной лимит вызовов ассистента исчерпан. Следующий вызов станет доступен завтра.',
  unavailable: 'Ассистент сейчас недоступен: ИИ выключен или сервис не отвечает. Текст пока пишется руками.',
  'bad-request': 'Ассистент не принял запрос. Проверьте тему и уровень.',
  forbidden: 'Нужны права администратора.',
  network: 'Не удалось связаться с сервером. Проверьте связь и попробуйте ещё раз.',
  unknown: 'Ассистент не ответил. Попробуйте ещё раз через минуту.',
};

function kindByStatus(status: number): AssistantErrorKind {
  if (status === 429) return 'limit';
  if (status === 503) return 'unavailable';
  if (status === 400) return 'bad-request';
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 0) return 'network';
  return 'unknown';
}

function bodyText(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim();
  if (!payload || typeof payload !== 'object') return '';
  const body = payload as Record<string, unknown>;
  // Контракт ассистента — поле `error`; message/title оставлены для прокси,
  // который на своих ошибках отвечает ProblemDetails. Вложенное `data` берём
  // тоже: клиент пробрасывает тело как `{status, data}`.
  return (
    text(body.error) ||
    text(body.message) ||
    text(body.title) ||
    (body.data ? bodyText(body.data) : '')
  );
}

function statusOf(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (!input || typeof input !== 'object') return null;
  const candidate = (input as { status?: unknown }).status;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

/**
 * Разбор неудачи вызова.
 *
 * Текст из поля `error` важнее любого своего: сервер знает, кончился ли общий
 * лимит, выключен ли ключ или тема не прошла фильтр, и именно эту фразу
 * админу нужно прочитать. Свои тексты — только когда тела нет вовсе.
 */
export function normalizeAssistantError(
  statusOrError: unknown,
  payload?: unknown
): AssistantError {
  const status = statusOf(statusOrError);
  const message =
    bodyText(payload) ||
    (statusOrError instanceof Error ? text(statusOrError.message) : '') ||
    bodyText(statusOrError);

  // Сеть не отвечает вовсе: статуса нет, в сообщении — «Failed to fetch».
  if (status === null) {
    const looksOffline = /fetch|network|failed|timeout/i.test(message) || !message;
    const kind: AssistantErrorKind = looksOffline ? 'network' : 'unknown';
    return { kind, message: message && !looksOffline ? message : DEFAULT_BY_KIND[kind] };
  }

  const kind = kindByStatus(status);
  return { kind, message: message || DEFAULT_BY_KIND[kind] };
}
