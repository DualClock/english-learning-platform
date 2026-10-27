/*
 * Проверка роли для админских маршрутов — отдельным модулем, а не внутри
 * middleware.ts.
 *
 * Причина: middleware.ts импортируется Next для каждого матча и его нельзя
 * покрыть юнит-тестом — он тянет next/server. Логика «есть ли роль в зашифрованной
 * куке NextAuth» должна проверяться тестом, потому что цена ошибки здесь
 * асимметрична: ложный пропуск отдаёт админку любому, а ложный запрет закрывает
 * её даже владельцу.
 */
import type { NextRequest } from 'next/server';

/** Имя роли, которую выдаёт бэкенд (см. AppRoles.Admin в C#). */
export const ADMIN_ROLE = 'Admin';

/**
 * Возвращает роли из сессионной куки NextAuth или null, если куки нет.
 *
 * Расшифровка делается только при наличии NEXTAUTH_SECRET: без него NextAuth
 * не может прочитать свою же куку, и лучше честно вернуть null (доступ
 * закроется), чем пропустить.
 */
export type RoleReader = (request: NextRequest) => Promise<string[] | null>;

export function hasAdminRole(roles: string[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.includes(ADMIN_ROLE);
}

/**
 * Кука сессии NextAuth. __Secure- вариант появляется при NEXTAUTH_URL на https —
 * ровно по тому же правилу, что в src/app/api/auth/[...nextauth]/route.ts.
 */
export function sessionCookieNames(secureUrl: string | undefined): string[] {
  const secure = (secureUrl ?? '').startsWith('https://');
  return [
    ...(secure ? ['__Secure-next-auth.session-token'] : []),
    'next-auth.session-token',
  ];
}

/**
 * Есть ли кука сессии вообще. Дешёвая проверка, не требующая секрета:
 * используется, чтобы отличить «не вошёл» (→ /login) от «вошёл, но не админ»
 * (→ 404, не раскрывая существование админки).
 */
export function hasSessionCookie(request: NextRequest, secureUrl: string | undefined): boolean {
  return sessionCookieNames(secureUrl).some((name) => Boolean(request.cookies.get(name)?.value));
}
