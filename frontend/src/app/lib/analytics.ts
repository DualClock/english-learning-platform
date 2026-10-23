import { useSession } from 'next-auth/react';
import { API_URL } from '@/app/lib/api-url';

/**
 * Отправка аналитического события на бэкенд.
 * Никогда не бросает исключений и не ломает UX: все ошибки проглатываются.
 *
 * sessionAccessToken передаётся явно (из useSession().data.accessToken),
 * чтобы хелпер можно было вызывать из любого места компонента.
 */
export async function track(
  event: string,
  meta?: string,
  sessionAccessToken?: string | null
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionAccessToken) {
      headers.Authorization = `Bearer ${sessionAccessToken}`;
    }

    await fetch(`${API_URL}/api/analytics/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event, meta }),
    });
  } catch {
    // аналитика не должна ломать UX
  }
}

/** Удобный хук: возвращает track с уже подставленным токеном сессии. */
export function useTrack() {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;
  return (event: string, meta?: string) => track(event, meta, token);
}

/*
 * ---- Гостевая воронка публичного /test (W2.4) ------------------------------
 *
 * Аутентифицированный `/api/analytics/event` гостю недоступен: он закрыт
 * `[Authorize]` и принимает свободную строку `meta` до 500 символов. Поэтому
 * для /test есть отдельный анонимный эндпоинт с контрактом в три поля, где
 * свободному тексту места нет. Здесь живут ровно те поля, что сервер разрешает:
 * имя события, уровень и nonce против дублей.
 *
 * Третье событие из плана — «ушёл с теста до результата» — не отправляется:
 * причина и разбор надёжности доставки лежат в
 * AnonymousAnalyticsController.AllowedEvents (сервер — источник истины по
 * списку, этот файл — его зеркало).
 */

/** Путь зеркалит роут AnonymousAnalyticsController. */
export const GUEST_ANALYTICS_PATH = '/api/analytics/anonymous';

/**
 * События, которые гость имеет право прислать. Любое другое имя сервер
 * отклоняет 400 — молча и без вреда для человека на экране.
 */
export const GUEST_EVENTS = {
  testStarted: 'placement_test_started',
  testCompleted: 'placement_test_completed',
} as const;

export type GuestEvent = (typeof GUEST_EVENTS)[keyof typeof GUEST_EVENTS];

/**
 * Ключ против двойной отправки: одна и та же отправка = одна строка в базе.
 * Генерируется на проход теста, поэтому ретрей после обрыва сети счётчик не
 * удваивает, а повторный проход — это действительно новый проход.
 */
export function guestDedupeKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // crypto.randomUUID появился в HTTPS-контексте; на старом браузере или в
    // http-dev без secure context фолбэк обязан остаться в рамках регулярки
    // сервера: 8–64 символа [A-Za-z0-9_-].
    return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Ключи одного прохода теста: старт и результат меряются раздельно. */
export interface GuestPassKeys {
  started: string;
  completed: string;
}

/** Оба ключа одного прохода. */
export function guestPassKeys(): GuestPassKeys {
  return { started: guestDedupeKey(), completed: guestDedupeKey() };
}

export interface GuestTrackOptions {
  /** Только для placement_test_completed: код CEFR из ответа сервера (a1…c1). */
  level?: string;
  /** Ключ прохода; если не передан — создаётся новый (одноразовая отправка). */
  dedupeKey?: string;
}

/**
 * Гостевое событие воронки. Как и track(), ничего не бросает и не ждёт
 * ответа: человек на /test не должен заметить ни падения аналитики, ни её
 * задержки. Никаких cookie и токена: запрос анонимный по построению.
 */
export async function trackGuest(event: GuestEvent, options: GuestTrackOptions = {}): Promise<void> {
  try {
    // Тело собирается здесь, а не из «всего, что попросили»: так нельзя
    // случайно отправить на анонимный путь поле со свободным текстом.
    const body: Record<string, string> = {
      event,
      dedupeKey: options.dedupeKey ?? guestDedupeKey(),
    };
    if (options.level) {
      body.level = options.level;
    }

    await fetch(`${API_URL}${GUEST_ANALYTICS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // аналитика не должна ломать UX
  }
}
