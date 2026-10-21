'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import Sidebar from './Sidebar';
import { MenuIcon, SpinnerIcon } from './ui/icons';
import { transition } from '@/lib/motion';
import { prefetchApi } from '@/app/lib/api-client';

// Данные вкладок, которые прогреваются в фоне сразу после входа:
// первое открытие любой вкладки происходит без ожидания сети.
const WARMUP_PATHS = [
  '/api/books',
  '/api/books/popular',
  '/api/books/stories',
  '/api/profile',
  '/api/dictionary',
  '/api/wordlists',
  '/api/categories',
  '/api/review/today',
  '/api/grammar/units',
  '/api/progress/streak',
  '/api/progress/achievements',
  '/api/progress/today-plan',
];

let warmupStarted = false;

export default function AppLayout({
  children,
  width = 'content',
}: {
  children: React.ReactNode;
  /** 'full' — на весь экран (читалка), 'content' — с ограниченной колонкой */
  width?: 'content' | 'full';
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Прогрев кэша остальных вкладок в простое — чтобы переход был мгновенным
  useEffect(() => {
    if (!session?.accessToken || warmupStarted) return;
    warmupStarted = true;

    const run = () => prefetchApi(WARMUP_PATHS, session.accessToken);
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (win.requestIdleCallback) win.requestIdleCallback(run, { timeout: 3000 });
    else window.setTimeout(run, 1500);
  }, [session]);

  // Возвращаем фокус на бургер после закрытия drawer (не при первом рендере)
  const prevSidebarOpen = useRef(false);
  useEffect(() => {
    if (prevSidebarOpen.current && !sidebarOpen) {
      burgerRef.current?.focus();
    }
    prevSidebarOpen.current = sidebarOpen;
  }, [sidebarOpen]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <SpinnerIcon size={24} label="Загрузка" className="text-primary" />
      </div>
    );
  }

  if (!session) {
    return null;
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
      </header>

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="lg:ml-64 min-h-screen">
        {/*
          Вход кадра: только прозрачность. transform на этом узле сделал бы все
          position:fixed внутри страницы зависимыми от него, поэтому travel здесь
          сознательно нет — направление перехода показывают сами экраны.
        */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={transition.page}
          className={
            width === 'full'
              ? 'px-4 sm:px-6 lg:px-8 py-6 lg:py-8'
              : 'max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8'
          }
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
