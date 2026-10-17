'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Sidebar from './Sidebar';

export default function AppLayout({
  children,
  fullWidth = false,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
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
      <div className="min-h-screen bg-[var(--color-surface)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-surface)]">
      {/* Мобильная шапка с бургером */}
      <header className="lg:hidden sticky top-0 z-20 h-14 bg-navy flex items-center gap-3 px-4">
        <button
          type="button"
          ref={burgerRef}
          onClick={() => setSidebarOpen(true)}
          className="p-2.5 -ml-2 text-white rounded-md hover:bg-white/10 transition-colors"
          aria-label="Открыть меню"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-lg font-semibold text-white font-heading">Lexicon</span>
      </header>

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="lg:ml-64 min-h-screen">
        <div className={fullWidth ? 'px-4 sm:px-6 lg:px-8 py-6 lg:py-8' : 'max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8'}>
          {children}
        </div>
      </main>
    </div>
  );
}
