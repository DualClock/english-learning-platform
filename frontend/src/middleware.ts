import { NextResponse, type NextRequest } from 'next/server';

/*
 * Приватные разделы на сервере, а не в браузере.
 *
 * До этой задачи гейт жил в src/components/AppLayout.tsx: краулер получал
 * 200 со спиннером «Проверяем сессию» и только после JS уходил на /login.
 * Для Яндекса это пустые, но проиндексированные страницы-дубли. Middleware
 * отвечает до рендеринга: нет куки сессии — сразу 307 на /login.
 *
 * Проверяется именно наличие куки, а не валидность JWT: NEXTAUTH_SECRET нужен
 * для декодирования, а middleware должен работать и на стенде без него.
 * Поддельную или просроченную куку по-прежнему отсекает клиентский гейт и
 * NextAuth на /api/* — это второй слой, а не замена первого.
 *
 * Disallow в robots.txt от индекса не спасает, поэтому приватные ответы
 * получают X-Robots-Tag: noindex, nofollow — и без сессии, и с ней.
 */
const SESSION_COOKIES = [
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

const NO_INDEX = { 'X-Robots-Tag': 'noindex, nofollow' };

export function middleware(request: NextRequest) {
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
