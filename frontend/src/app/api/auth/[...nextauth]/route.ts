import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5226';

const handler = NextAuth({
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
            token: data.token,
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
        token.userId = user.userId;
        token.avatarUrl = user.avatarUrl ?? null;
      }
      // update({ avatarUrl }) после смены аватара на клиенте
      if (trigger === 'update' && session?.avatarUrl !== undefined) {
        token.avatarUrl = session.avatarUrl;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.avatarUrl = token.avatarUrl ?? null;
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
