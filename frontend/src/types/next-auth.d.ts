import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    token: string;
    refreshToken?: string;
    userId: string;
    displayName?: string;
    avatarUrl?: string | null;
    avatarFrame?: string | null;
    accentTheme?: string | null;
  }

  interface Session {
    avatarUrl?: string | null;
    avatarFrame?: string | null;
    accentTheme?: string | null;
    tokenError?: string | null;
    user: {
      id: string;
      /*
       * Отдельное имя пользователя из бэкенда. Живёт рядом с `name`,
       * потому что `name` приходит из JWT и у незаполненного профиля
       * равно null — на него одного опираться нельзя.
       */
      displayName?: string | null;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    accessTokenExpiresAt?: number;
    refreshToken?: string;
    tokenError?: string;
    userId?: string;
    avatarUrl?: string | null;
    avatarFrame?: string | null;
    accentTheme?: string | null;
  }
}
