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
    accessToken?: string;
    avatarUrl?: string | null;
    avatarFrame?: string | null;
    accentTheme?: string | null;
    tokenError?: string | null;
    user: {
      id: string;
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
