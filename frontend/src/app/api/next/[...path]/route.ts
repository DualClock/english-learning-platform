import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/*
 * Серверный прокси браузерных запросов к API.
 *
 * Зачем он существует: access-токен API раньше отдавался в `/api/auth/session`
 * и попадал в JS — любой XSS (а CSP до сих пор без `default-src`) означал кражу
 * аккаунта на 7 суток, потому что ревокации нет. Теперь токен живёт только в
 * зашифрованной httpOnly-куке NextAuth: браузер ходит на этот роут своим origin'ом,
 * роут читает куку через `getToken()` и подставляет `Authorization` сам.
 *
 * Требования к поведению:
 *  - токен НИКОГДА не попадает ни в тело ответа, ни в заголовки, ни в логи;
 *  - JSON и бинарь (обложки, речь) проходят насквозь без пересборки;
 *  - запросы к API не кэшируются ни на одном слое: ответ зависит от куки;
 *  - 401 от бэкенда возвращается как 401, чтобы api-client показал «войдите заново»,
 *    а не «ошибка сервера».
 *
 * Почему не Edge: в node-рантайме `fetch` умеет стримить `ReadableStream` в теле
 * запроса и ответа, а `Buffer`-путь для бинаря там не нужен вовсе.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5226';

export const runtime = 'nodejs';
// Ответ зависит от куки пользователя и от состояния бэкенда — кэшировать нельзя.
export const dynamic = 'force-dynamic';

/** Заголовки запроса, которые прокси не должен пробрасывать. */
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'authorization', // подставляет только прокси
  'cookie', // кука сессии NextAuth относится к Next, а не к API
  'accept-encoding', // undici сам договорится о сжатии и распакует ответ
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
]);

/** Заголовки ответа, которые нельзя отдавать браузеру как есть. */
const DROPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie', // куки API пользователю не нужны и не должны его касаться
]);

/**
 * Пути API, которые НЕ требуют нашей сессии.
 *
 * Регистрация по определению публична: у человека ещё нет аккаунта, значит и
 * куки NextAuth нет. Раньше прокси требовал токен для любого пути и отвечал
 * `401 unauthorized` — форма регистрации молча не работала, а человек видел
 * «не удалось создать аккаунт». Нашёл это живым прогоном, все автотесты были
 * зелёными: они ходили в API напрямую, минуя прокси.
 *
 * Список именно белый, а не «всё, кроме приватного»: новая приватная ручка
 * по умолчанию защищена.
 */
const PUBLIC_PATHS = [
  'auth/register',
  /*
   * Гостевые ручки читалки. Они `[AllowAnonymous]` на бэкенде и живут ровно
   * затем, чтобы человек без аккаунта мог почитать первую главу и получить
   * перевод слова. Сессии у гостя нет по определению.
   *
   * Почему через прокси, а не напрямую, как было раньше: гостевые адреса
   * собирались из NEXT_PUBLIC_API_URL, а это адрес, который в браузере НЕ
   * совпадает с origin страницы. Локально не работало вообще (127.0.0.1
   * против localhost — CORS), а по внешнему адресу или с телефона гость
   * уходил на свой собственный localhost и получал «Не удалось получить
   * перевод». Через прокси запрос идёт тем же origin, что и страница.
   */
  'guest',
];

function isPublicPath(segments: string[]): boolean {
  const key = segments.join('/').toLowerCase();
  return PUBLIC_PATHS.some((allowed) => key === allowed || key.startsWith(`${allowed}/`));
}

function buildTargetUrl(req: NextRequest, segments: string[]): URL {
  const target = new URL(API_URL);
  const basePath = target.pathname.replace(/\/+$/, '');
  const rest = segments.map((segment) => encodeURIComponent(segment)).join('/');
  target.pathname = `${basePath}/api/${rest}`;
  target.search = req.nextUrl.search;
  return target;
}

function hasBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

async function proxy(req: NextRequest, params: { path?: string[] }): Promise<Response> {
  const segments = params.path ?? [];
  if (segments.length === 0) {
    return NextResponse.json({ error: 'Не указан путь API' }, { status: 400 });
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = token?.accessToken;
  const isPublic = isPublicPath(segments);

  if (!isPublic && (typeof accessToken !== 'string' || accessToken.length === 0)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!DROPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  // Authorization подставляем только когда токен есть: на публичном маршруте
  // пустой заголовок бэкенд может отвергнуть раньше самой валидации тела.
  if (typeof accessToken === 'string' && accessToken.length > 0) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    redirect: 'manual',
    cache: 'no-store',
  };

  if (hasBody(req.method) && req.body) {
    // C#-контроллеры читают multipart (загрузка EPUB, аватара) — тело нельзя
    // буферизовать целиком: файл на 20 МБ должен уходить потоком.
    init.body = req.body;
    init.duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(buildTargetUrl(req, segments), init);
  } catch (error) {
    /*
     * Диагностика: без неё «не удалось создать аккаунт» одинаково выглядит
     * при упавшем API, неверном NEXT_PUBLIC_API_URL и отсутствии сети.
     */
    console.error(
      '[proxy] API недоступен:',
      `${req.method} ${segments.join('/')}`,
      '->',
      buildTargetUrl(req, segments).toString(),
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: 'backend_unreachable', target: buildTargetUrl(req, segments).toString() }, { status: 502 });
  }

  /*
   * Строка на каждый не-успешный ответ. Именно её не хватало при разборе
   * «форма не работает»: статус 429/401/400 уходил в браузер без следа в
   * терминале, и приходилось угадывать.
   */
  if (!upstream.ok) {
    console.warn(
      '[proxy]',
      `${req.method} /api/${segments.join('/')}`,
      '->',
      upstream.status,
      upstream.statusText,
      isPublic ? '(публичный путь)' : '(с сессией)'
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROPPED_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
  });
  responseHeaders.set('Cache-Control', 'no-store');

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export async function GET(req: NextRequest, ctx: { params: { path?: string[] } }) {
  return proxy(req, ctx.params);
}

export async function POST(req: NextRequest, ctx: { params: { path?: string[] } }) {
  return proxy(req, ctx.params);
}

export async function PUT(req: NextRequest, ctx: { params: { path?: string[] } }) {
  return proxy(req, ctx.params);
}

export async function PATCH(req: NextRequest, ctx: { params: { path?: string[] } }) {
  return proxy(req, ctx.params);
}

export async function DELETE(req: NextRequest, ctx: { params: { path?: string[] } }) {
  return proxy(req, ctx.params);
}
