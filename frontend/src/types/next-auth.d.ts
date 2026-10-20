import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    token: string;
    userId: string;
    displayName?: string;
    avatarUrl?: string | null;
  }

  interface Session {
    accessToken?: string;
    avatarUrl?: string | null;
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    userId?: string;
    avatarUrl?: string | null;
  }
}
