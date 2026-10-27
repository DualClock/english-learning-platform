import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { hasAdminRole } from '@/lib/admin-access';

/*
 * Приватные разделы на сервере, а не в браузере.
 *
 * До этой задачи гейт жил в src/components/AppLayout.tsx: краулер получал
 * 200 со спиннером «Проверяем сессию» и только после JS уходил на /login.
 * Для Яндекса это пустые, но проиндексированные страницы-дубли. Middleware
 * отвечает до рендеринга: нет куки сессии — сразу 307 на /login.
 *
 * /admin проверяется строже: кроме куки нужна роль Admin в сессии. Для
 * остальных разделов достаточно куки — поддельную или просроченную куку
 * по-прежнему отсекает клиентский гейт и NextAuth на /api/*, это второй слой.
 *
 * Disallow в robots.txt от индекса не спасает, поэтому приватные ответы
 * получают X-Robots-Tag: noindex, nofollow — и без сессии, и с ней.
 */
const SESSION_COOKIES = [
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

const NO_INDEX = { 'X-Robots-Tag': 'noindex, nofollow' };

/**
 * /admin без роли Admin — 404, а не 403.
 *
 * 403 говорит «раздел существует, но вам нельзя» — это подсказка для
 * перебора. 404 не отличает админку от несуществующего пути.
 */
function notFound(): NextResponse {
  const response = new NextResponse('Not Found', { status: 404 });
  for (const [key, value] of Object.entries(NO_INDEX)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function middleware(request: NextRequest) {
  // Гостевой режим чтения: preview-глава открыта без сессии. Ветка стоит до
  // проверки куки и без X-Robots-Tag: страница нужна краулеру и человеку,
  // который ещё не завёл аккаунт, — иначе он получил бы пустую заглушку вместо
  // отрывка книги. Матчер (`/reader/:path*`) этот путь не исключает, поэтому
  // исключение живёт здесь явно.
  if (request.nextUrl.pathname.startsWith('/reader/preview')) {
    return NextResponse.next();
  }

  const hasSessionCookie = SESSION_COOKIES.some((name) =>
    Boolean(request.cookies.get(name)?.value),
  );

  if (!hasSessionCookie) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    // callbackUrl — абсолютный адрес запрашиваемой страницы: /login
    // (src/app/login/page.tsx) возвращает на него после входа.
    loginUrl.searchParams.set('callbackUrl', request.url);

    const redirect = NextResponse.redirect(loginUrl, 307);
    for (const [key, value] of Object.entries(NO_INDEX)) {
      redirect.headers.set(key, value);
    }
    return redirect;
  }

  // Админка: куки мало, нужна роль. Проверяется здесь, а не только в UI,
  // потому что «кнопку не показываем» защитой не является — на /admin
  // можно зайти по прямой ссылке.
  if (request.nextUrl.pathname.startsWith('/admin')) {
    let roles: string[] | undefined;

    try {
      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
      });
      roles = Array.isArray(token?.roles) ? (token!.roles as string[]) : undefined;
    } catch {
      // Без NEXTAUTH_SECRET (или с битой кукой) расшифровать сессию нельзя.
      // Честнее закрыть админку, чем пропустить.
      roles = undefined;
    }

    if (!roles || !hasAdminRole(roles)) {
      return notFound();
    }
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(NO_INDEX)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Matcher перечисляет приватные префиксы явно: единый «всё, кроме публичного»
 * ловил бы и /api/*, и статику, и страницы восстановления пароля, до которых
 * пользователь без сессии обязан добраться.
 *
 * Массив обязан быть литералом: Next читает экспорт config статически (без
 * выполнения файла) и значение, посчитанное в рантайме (flatMap по списку
 * префиксов), не резолвит — middleware начинал матчить вообще всё, включая /.
 * `:path*` = «ноль или больше сегментов», поэтому голый префикс тоже покрыт.
 */
export const config = {
  matcher: [
    '/admin/:path*',
    // Личная библиотека пользователя: без сессии там нечего показывать, а
    // AppLayout гейтал её только в браузере — краулер видел 200 со спиннером
    // «Проверяем сессию». Публичная полка живёт на /library и в этот matcher
    // не входит (проверено curl'ом: /library отдаёт 200 анонимно).
    '/books/:path*',
    '/categories/:path*',
    '/dashboard/:path*',
    '/dictionary/:path*',
    '/grammar/:path*',
    '/listening/:path*',
    '/practice/:path*',
    '/profile/:path*',
    '/progress/:path*',
    '/quiz/:path*',
    '/reader/:path*',
    '/review/:path*',
    '/settings/:path*',
    '/translator/:path*',
    '/writing/:path*',
  ],
};
