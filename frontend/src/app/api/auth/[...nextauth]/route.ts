import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5226';

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
// Access-токен API живёт 7 дней. Обновляем его заранее, пока сессия ещё жива.
const ACCESS_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
const useSecureCookies = (process.env.NEXTAUTH_URL ?? '').startsWith('https://');

function tokenExpiresAt(token?: string): number | undefined {
  if (!token) return undefined;
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data?.exp === 'number' ? data.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

const handler = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
    // Сессия обновляется не чаще раза в сутки: активный читатель не разлогинится,
    // а лишние записи cookie на каждый запрос не нужны.
    updateAge: 24 * 60 * 60,
  },
  jwt: {
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  cookies: {
    sessionToken: {
      name: `${useSecureCookies ? '__Secure-' : ''}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
        maxAge: SESSION_MAX_AGE_SECONDS,
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });

          // 401 — действительно неверная пара email/пароль
          if (res.status === 401) return null;

          // Остальные коды (500/503) — сломанный бэкенд или недоступная база.
          // Возвращаем null (иначе NextAuth уводит на /api/auth/error), но пишем
          // причину в лог; страница входа отдельно спрашивает /health и
          // показывает «сервис недоступен» вместо «неверный пароль».
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.error(`Login backend error: ${res.status} ${body.slice(0, 300)}`);
            return null;
          }

          const data = await res.json();

          return {
            id: String(data.userId),
            userId: String(data.userId),
            email: data.email || credentials.email,
            name: data.displayName,
            displayName: data.displayName,
            avatarUrl: data.avatarUrl ?? null,
            avatarFrame: data.avatarFrame ?? 'none',
            accentTheme: data.accentTheme ?? 'teal',
            token: data.token,
            refreshToken: data.refreshToken,
          };
        } catch (error) {
          console.error('Auth error:', error);
          return null;
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.accessToken = user.token;
        token.refreshToken = user.refreshToken;
        token.accessTokenExpiresAt = tokenExpiresAt(user.token);
        token.tokenError = undefined;
        token.userId = user.userId;
        token.avatarUrl = user.avatarUrl ?? null;
        token.avatarFrame = user.avatarFrame ?? 'none';
        token.accentTheme = user.accentTheme ?? 'teal';
      }

      // update({ avatarUrl }) после смены аватара на клиенте
      if (trigger === 'update') {
        if (session?.avatarUrl !== undefined) token.avatarUrl = session.avatarUrl;
        if (session?.avatarFrame !== undefined) token.avatarFrame = session.avatarFrame;
        if (session?.accentTheme !== undefined) token.accentTheme = session.accentTheme;
      }

      const expiresAt = token.accessTokenExpiresAt ?? tokenExpiresAt(token.accessToken);
      const shouldRefresh =
        Boolean(token.refreshToken) &&
        Boolean(expiresAt) &&
        Date.now() > (expiresAt as number) - ACCESS_REFRESH_WINDOW_MS;

      if (shouldRefresh) {
        try {
          const res = await fetch(`${API_URL}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: token.refreshToken }),
          });

          if (!res.ok) {
            throw new Error(`Refresh failed: ${res.status}`);
          }

          const data = await res.json();
          if (!data?.token) {
            throw new Error('Refresh returned no token');
          }

          token.accessToken = data.token;
          token.refreshToken = data.refreshToken ?? token.refreshToken;
          token.accessTokenExpiresAt = tokenExpiresAt(data.token);
          token.tokenError = undefined;
        } catch (error) {
          // Не выкидываем из аккаунта: сессия NextAuth ещё жива, а API-ошибку
          // интерфейс покажет как «нет связи», не как «войдите заново».
          console.error('API token refresh error:', error);
          token.tokenError = 'RefreshAccessTokenError';
        }
      }

      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.avatarUrl = token.avatarUrl ?? null;
      session.avatarFrame = token.avatarFrame ?? 'none';
      session.accentTheme = token.accentTheme ?? 'teal';
      session.tokenError = token.tokenError ?? null;
      if (token.userId) {
        session.user.id = token.userId;
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',
  }
});

export { handler as GET, handler as POST };
