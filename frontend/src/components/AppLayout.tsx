'use client';

import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './Sidebar';
import MobileTabBar from './MobileTabBar';
import AchievementCelebration from './progress/AchievementCelebration';
import LexiSign from './brand/lexi/LexiSign';
import Button from './ui/Button';
import { AlertIcon, MenuIcon, RefreshIcon, SpinnerIcon } from './ui/icons';
import { applyAccent, normalizeAccent, writeAccent } from '@/lib/theme';


export default function AppLayout({
  children,
  width = 'content',
  immersive = false,
}: {
  children: React.ReactNode;
  /** 'full' — на весь экран (читалка), 'content' — с ограниченной колонкой */
  width?: 'content' | 'full';
  /** Полноэкранная комната без общей навигации: читалка сама держит свои панели */
  immersive?: boolean;
}) {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authProbe, setAuthProbe] = useState<'idle' | 'checking' | 'offline'>('idle');
  const burgerRef = useRef<HTMLButtonElement>(null);
  const probeInFlightRef = useRef(false);
  const autoProbeDoneRef = useRef(false);
  const tokenRefreshInFlightRef = useRef(false);

  /**
   * `unauthenticated` от SessionProvider означает и «сессии нет», и «не смогли
   * спросить сервер» — при обрыве сети NextAuth не различает эти случаи.
   * Поэтому перед редиректом проверяем сессию отдельным запросом: сетевую
   * ошибку показываем как «нет связи» и оставляем человека в приложении,
   * а на /login уводим только когда сервер действительно ответил «сессии нет».
   */
  const verifySession = useCallback(async () => {
    if (probeInFlightRef.current) return;
    probeInFlightRef.current = true;
    setAuthProbe('checking');

    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      if (!res.ok) {
        setAuthProbe('offline');
        return;
      }

      const data = await res.json();
      if (!data?.user) {
        setAuthProbe('idle');
        router.replace(`/login?reason=session-expired&callbackUrl=${encodeURIComponent(pathname || '/dashboard')}`);
        return;
      }

      // Сессия на сервере есть. Перезагружаем кадр, чтобы SessionProvider
      // получил её заново; один раз, чтобы не зациклиться на плохой сети.
      const lastRecovery = Number(window.sessionStorage.getItem('lexicon:auth-recovery') || 0);
      if (Date.now() - lastRecovery < 10_000) {
        setAuthProbe('offline');
        return;
      }
      window.sessionStorage.setItem('lexicon:auth-recovery', String(Date.now()));
      window.location.reload();
    } catch {
      setAuthProbe('offline');
    } finally {
      probeInFlightRef.current = false;
    }
  }, [pathname, router]);

  useEffect(() => {
    if (status === 'authenticated') {
      autoProbeDoneRef.current = false;
      window.sessionStorage.removeItem('lexicon:auth-recovery');
      setAuthProbe('idle');
      return;
    }
    if (status === 'unauthenticated' && !autoProbeDoneRef.current) {
      autoProbeDoneRef.current = true;
      void verifySession();
    }
  }, [status, verifySession]);

  // Вернулась сеть — сразу пробуем восстановить сессию, без ручного «Повторить».
  useEffect(() => {
    if (authProbe !== 'offline') return;
    const onOnline = () => void verifySession();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [authProbe, verifySession]);

  // API вернул 401, хотя cookie сессии ещё жива: просим NextAuth обновить
  // access-токен. Разлогин случится только если сессии действительно нет.
  useEffect(() => {
    const onUnauthorized = () => {
      if (tokenRefreshInFlightRef.current) return;
      tokenRefreshInFlightRef.current = true;
      void update().finally(() => {
        window.setTimeout(() => {
          tokenRefreshInFlightRef.current = false;
        }, 5000);
      });
    };
    window.addEventListener('lexicon:unauthorized', onUnauthorized);
    return () => window.removeEventListener('lexicon:unauthorized', onUnauthorized);
  }, [update]);

  // Акцент хранится в профиле и приезжает в сессии: применяем его сразу
  // после входа и после «Применить» в настройках.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const accent = normalizeAccent(session?.accentTheme);
    applyAccent(accent);
    writeAccent(accent);
  }, [status, session?.accentTheme]);

  // Возвращаем фокус на бургер после закрытия drawer (не при первом рендере)
  const prevSidebarOpen = useRef(false);
  useEffect(() => {
    if (prevSidebarOpen.current && !sidebarOpen) {
      burgerRef.current?.focus();
    }
    prevSidebarOpen.current = sidebarOpen;
  }, [sidebarOpen]);

  if (
    status === 'loading' ||
    (status === 'unauthenticated' && authProbe === 'idle') ||
    authProbe === 'checking'
  ) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <SpinnerIcon size={24} label="Проверяем сессию" className="text-primary" />
      </div>
    );
  }

  if (status !== 'authenticated' || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
        <div
          role="alert"
          className="card w-full max-w-md p-8 text-center"
        >
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-surface-warning text-on-warning">
            <AlertIcon size={24} />
          </div>
          <h1 className="mb-2 text-h2 text-ink">Нет связи с сервером</h1>
          <p className="mb-6 text-body-sm leading-relaxed text-slate">
            Вы остались в аккаунте — не удалось только проверить сессию.
            Проверьте интернет: как только связь вернётся, продолжим с того же места.
          </p>
          <Button variant="primary" onClick={() => void verifySession()}>
            <RefreshIcon size={16} />
            Повторить
          </Button>
        </div>
      </div>
    );
  }

  // Читалка — отдельная комната: ни общего сайдбара, ни мобильной шапки.
  // Сессия уже проверена выше, поэтому отдаём кадр целиком.
  if (immersive) {
    return (
      <>
        {children}
        <AchievementCelebration />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Мобильная шапка с бургером */}
      <header className="lg:hidden sticky top-0 z-20 h-14 bg-navy flex items-center gap-3 px-4">
        <button
          type="button"
          ref={burgerRef}
          onClick={() => setSidebarOpen(true)}
          className="p-2.5 -ml-2 rounded-md text-on-dark hover:bg-white/10 transition-colors duration-fast ease-soft"
          aria-label="Открыть меню"
        >
          <MenuIcon size={24} />
        </button>
        <span className="text-h3 font-heading text-on-dark">Lexicon</span>
        <LexiSign pageKey={pathname} className="ml-auto h-6 w-6 shrink-0" />
      </header>

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="lg:ml-64 min-h-screen">
        {/*
          Вход кадра: только прозрачность, средствами CSS-слоя (globals.css).
          Через JS-анимацию скрывать контент нельзя — в невидимой вкладке,
          у краулеров и на снимках кадр остался бы пустым.
        */}
        <div
          className={
            width === 'full'
              ? // pb-24 на мобиле — место под нижнюю панель навигации (56px) плюс запас.
                'animate-page-in px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:pb-8 lg:py-8'
              : 'animate-page-in mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:pb-8 lg:py-8'
          }
        >
          {children}
        </div>
      </main>
      <MobileTabBar />
      <AchievementCelebration />
    </div>
  );
}
