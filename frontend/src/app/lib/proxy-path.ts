/*
 * Единственная точка склейки адреса для браузерных запросов к API.
 *
 * До этого модуля каждый компонент сам решал, куда идти: `fetch(\`${API_URL}...\`)`
 * уходил на бэкенд напрямую и тащил `Authorization: Bearer <accessToken>` из JS.
 * Токен при этом отдавался в `/api/auth/session`, то есть был доступен любому
 * скрипту на странице (и любой XSS стоил аккаунта на 7 дней).
 *
 * Теперь браузер ходит ТОЛЬКО на свой origin: `/api/next/<путь бэкенда>`, а
 * серверный роут `src/app/api/next/[...path]/route.ts` достаёт access-токен из
 * зашифрованной httpOnly-куки NextAuth и подставляет его сам. Токен не покидает
 * сервер ни в HTML, ни в JSON сессии, ни в заголовках, видимых из JS.
 *
 * Функция чистая и не зависит от `process.env`, чтобы её можно было проверить
 * юнит-тестом без запуска Next.
 */

/** Серверный префикс прокси. Совпадает с маршрутом `src/app/api/next/[...path]`. */
export const PROXY_PREFIX = '/api/next';

/**
 * Приводит путь бэкенда (`/api/books?page=1`) к адресу нашего прокси
 * (`/api/next/books?page=1`).
 *
 * Правила:
 *  - уже проксированный путь возвращается как есть — двойной вызов безопасен;
 *  - абсолютный URL (`https://...`) пропускается: внешние ссылки не проксируются;
 *  - query-строка и хэш сохраняются дословно (в них бывают `ref`, `utm`, точные
 *    идентификаторы книги, которые нельзя нормализовать).
 */
export function toProxyUrl(path: string): string {
  if (!path) return PROXY_PREFIX;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
  if (path === PROXY_PREFIX || path.startsWith(`${PROXY_PREFIX}/`)) return path;

  // `/api/books?page=1` → `/books?page=1`
  const withoutApi = path.startsWith('/api/') ? path.slice('/api'.length) : path;
  const normalized = withoutApi.startsWith('/') ? withoutApi : `/${withoutApi}`;
  return `${PROXY_PREFIX}${normalized}`;
}

/**
 * Обратное преобразование: из адреса прокси (`/api/next/books`) в путь бэкенда
 * (`/api/books`). Нужно серверному роуту, который принимает catch-all параметр,
 * уже разобранный Next, поэтому строкой пользуется только тест и отладка.
 */
export function toBackendPath(path: string): string {
  if (!path.startsWith(PROXY_PREFIX)) return path;
  const rest = path.slice(PROXY_PREFIX.length);
  return `/api${rest.startsWith('/') ? rest : `/${rest}`}`;
}
