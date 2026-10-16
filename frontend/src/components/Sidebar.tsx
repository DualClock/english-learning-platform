'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { ReactNode } from 'react';

const navigation: { name: string; href: string; icon: ReactNode }[] = [
  { name: 'Главная', href: '/dashboard', icon: '🏠' },
  { name: 'Библиотека', href: '/books', icon: '📚' },
  { name: 'Словарь', href: '/dictionary', icon: '📝' },
  { name: 'Повторение', href: '/review', icon: '🔄' },
  { name: 'Грамматика', href: '/grammar', icon: <GrammarIcon /> },
  { name: 'Тест', href: '/quiz', icon: '✓' },
  { name: 'AI Собеседник', href: '/translator', icon: '🤖' },
];

function GrammarIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.2C10.4 4.8 8.4 4.2 6 4.2c-1 0-2 .1-3 .4v13.9c1-.3 2-.4 3-.4 2.4 0 4.4.6 6 2 1.6-1.4 3.6-2 6-2 1 0 2 .1 3 .4V4.6c-1-.3-2-.4-3-.4-2.4 0-4.4.6-6 2zm0 0v13.9"
      />
    </svg>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-white border-r border-[var(--color-hairline-strong)] flex flex-col z-30">
      <div className="h-16 flex items-center px-6 border-b border-[var(--color-hairline-strong)]">
        <Link href="/dashboard" className="text-xl font-bold text-[var(--color-ink)]">
          Lexicon
        </Link>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[var(--color-tint-mint)] text-[var(--color-primary)]'
                  : 'text-[var(--color-slate)] hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[var(--color-hairline-strong)]">
        <Link
          href="/settings"
          className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors mb-2 ${
            pathname === '/settings'
              ? 'bg-[var(--color-tint-mint)] text-[var(--color-primary)]'
              : 'text-[var(--color-slate)] hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]'
          }`}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Настройки
        </Link>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-10 h-10 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center font-semibold">
            {session?.user?.email?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--color-ink)] truncate">
              {session?.user?.email}
            </p>
            <Link 
              href="/api/auth/signout" 
              className="text-xs text-[var(--color-slate)] hover:text-[var(--color-ink)]"
            >
              Выйти
            </Link>
          </div>
        </div>
      </div>
    </aside>
  );
}