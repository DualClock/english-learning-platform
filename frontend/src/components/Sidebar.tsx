'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { resolveAvatarSrc } from '@/app/lib/avatars';
import { prefetchApi } from '@/app/lib/api-client';
import { useCallback, type ReactNode } from 'react';

/** Данные, которые нужно прогреть в кэш при наведении на пункт меню. */
const ROUTE_PREFETCH: Record<string, string[]> = {
  '/dashboard': ['/api/books', '/api/profile', '/api/progress/streak', '/api/review/today', '/api/dictionary'],
  '/books': ['/api/books', '/api/books/popular', '/api/books/stories', '/api/profile'],
  '/dictionary': ['/api/dictionary', '/api/wordlists'],
  '/categories': ['/api/categories'],
  '/review': ['/api/review/today'],
  '/progress': ['/api/progress/achievements', '/api/progress/streak'],
  '/grammar': ['/api/grammar/units'],
  '/translator': ['/api/profile'],
  '/writing': ['/api/profile'],
  '/practice/dictation': ['/api/practice/dictation?count=5'],
  '/practice/pronunciation': ['/api/practice/minimal-pairs'],
  '/settings': ['/api/profile'],
};

const navigation: { name: string; href: string; icon: ReactNode }[] = [
  { name: 'Главная', href: '/dashboard', icon: '🏠' },
  { name: 'Библиотека', href: '/books', icon: '📚' },
  { name: 'Словарь', href: '/dictionary', icon: '📝' },
  { name: 'Категории', href: '/categories', icon: '🗂️' },
  { name: 'Повторение', href: '/review', icon: '🔄' },
  { name: 'Прогресс', href: '/progress', icon: '📈' },
  { name: 'Грамматика', href: '/grammar', icon: <GrammarIcon /> },
  { name: 'Тест', href: '/quiz', icon: '✓' },
  { name: 'Аудирование', href: '/practice/dictation', icon: '🎧' },
  { name: 'Произношение', href: '/practice/pronunciation', icon: '🗣️' },
  { name: 'Письмо', href: '/writing', icon: '✍️' },
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

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open = true, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const accessToken = session?.accessToken;

  // Наведение (или фокус) на пункт меню заранее тянет данные страницы,
  // поэтому клик открывает её уже с готовыми данными.
  const warmRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
      const paths = ROUTE_PREFETCH[href];
      if (paths) prefetchApi(paths, accessToken);
    },
    [router, accessToken]
  );

  const linkClass = (isActive: boolean) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-colors ${
      isActive
        ? 'bg-white text-[var(--color-navy)]'
        : 'text-[var(--color-on-dark-muted)] hover:bg-white/10 hover:text-white'
    }`;

  return (
    <>
      {/* Оверлей для мобильного drawer */}
      <div
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity lg:hidden ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`fixed left-0 top-0 h-full w-64 bg-navy flex flex-col z-40 transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
        aria-label="Основная навигация"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose?.();
        }}
      >
        <div className="h-16 flex items-center px-6 border-b border-white/10">
          <Link href="/dashboard" className="text-xl font-semibold text-white font-heading" onClick={onClose}>
            Lexicon
          </Link>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onClose}
                onMouseEnter={() => warmRoute(item.href)}
                onFocus={() => warmRoute(item.href)}
                onTouchStart={() => warmRoute(item.href)}
                className={linkClass(isActive)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="text-lg leading-none" aria-hidden="true">{item.icon}</span>
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
          <Link
            href="/settings"
            onClick={onClose}
            className={`${linkClass(pathname === '/settings')} mb-3`}
            aria-current={pathname === '/settings' ? 'page' : undefined}
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
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-10 h-10 rounded-full overflow-hidden shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveAvatarSrc(session?.avatarUrl)}
                alt="Аватар"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {session?.user?.email}
              </p>
              <Link
                href="/api/auth/signout"
                className="text-xs text-[var(--color-on-dark-muted)] hover:text-white"
              >
                Выйти
              </Link>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
