'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import LexiSign from './brand/lexi/LexiSign';
import FeedbackTrigger from './feedback/FeedbackTrigger';
import UserAvatar from './UserAvatar';
import { prefetchApi } from '@/app/lib/api-client';
import { displayNameOf } from '@/lib/display-name';
import { NAV_GROUPS, isRouteActive, type NavIconKey } from '@/lib/sidebar-nav';
import { useCallback, type ComponentType } from 'react';
import {
  BookOpenIcon,
  BooksIcon,
  BotIcon,
  FeedbackIcon,
  FoldersIcon,
  HeadphonesIcon,
  HomeIcon,
  MicIcon,
  NotebookIcon,
  PenIcon,
  RepeatIcon,
  SlidersIcon,
  TestIcon,
  TrendUpIcon,
  UserIcon,
  VolumeIcon,
  type IconProps,
} from './ui/icons';

/** Данные, которые нужно прогреть в кэш при наведении на пункт меню. */
const ROUTE_PREFETCH: Record<string, string[]> = {
  '/dashboard': ['/api/books', '/api/profile', '/api/progress/streak', '/api/review/today', '/api/dictionary'],
  '/books': ['/api/books', '/api/books/popular', '/api/books/stories', '/api/profile'],
  '/dictionary': ['/api/dictionary', '/api/wordlists'],
  '/categories': ['/api/categories'],
  '/review': ['/api/review/today'],
  '/progress': ['/api/progress/achievements', '/api/progress/streak'],
  '/profile': ['/api/profile', '/api/progress/achievements', '/api/progress/streak', '/api/progress/leaderboard', '/api/books'],
  '/grammar': ['/api/grammar/units'],
  '/translator': ['/api/profile'],
  '/writing': ['/api/profile'],
  '/practice/dictation': ['/api/practice/dictation?count=5'],
  '/practice/pronunciation': ['/api/practice/minimal-pairs'],
  '/settings': ['/api/profile'],
};

/**
 * Иконки по ключам из `lib/sidebar-nav`. Данные меню держатся без React,
 * чтобы их можно было проверить тестом без сборки; компоненты иконок
 * подключаются здесь.
 */
const ICONS: Record<NavIconKey, ComponentType<IconProps>> = {
  home: HomeIcon,
  books: BooksIcon,
  notebook: NotebookIcon,
  repeat: RepeatIcon,
  grammar: BookOpenIcon,
  headphones: HeadphonesIcon,
  volume: VolumeIcon,
  mic: MicIcon,
  pen: PenIcon,
  test: TestIcon,
  trend: TrendUpIcon,
  folders: FoldersIcon,
  bot: BotIcon,
  user: UserIcon,
  sliders: SlidersIcon,
  feedback: FeedbackIcon,
};

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open = true, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  // Наведение (или фокус) на пункт меню заранее тянет данные страницы,
  // поэтому клик открывает её уже с готовыми данными.
  const warmRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
      const paths = ROUTE_PREFETCH[href];
      if (paths) prefetchApi(paths);
    },
    [router]
  );

  return (
    <>
      {/* Оверлей для мобильного drawer. В закрытом состоянии снимается через
          visibility, чтобы не лежать невидимым слоем над всем текстом страницы. */}
      <div
        className={`fixed inset-0 z-30 bg-black/40 transition-[opacity,visibility] duration-fast ease-soft lg:hidden ${
          open ? 'opacity-100' : 'opacity-0 invisible pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`fixed left-0 top-0 h-full w-64 bg-navy flex flex-col z-40
          transition-[transform,visibility] duration-base ease-soft
          ${open ? 'translate-x-0 visible' : '-translate-x-full invisible'} lg:translate-x-0 lg:visible`}
        aria-label="Основная навигация"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose?.();
        }}
      >
        <div className="h-16 flex items-center px-6">
          <Link href="/dashboard" className="text-h2 font-heading text-on-dark" onClick={onClose}>
            Lexicon
          </Link>
          <LexiSign pageKey={pathname} className="ml-auto h-6 w-6 shrink-0" />
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto" aria-label="Разделы">
          {NAV_GROUPS.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex > 0 ? 'mt-5' : undefined}>
              {/*
               * Лейбл группы — ориентир, а не пункт меню: он не кликается
               * и не должен читаться скринридером как элемент навигации.
               */}
              <p className="px-4 pb-1.5 text-caption uppercase tracking-wider text-on-dark-muted" aria-hidden="true">
                {group.label}
              </p>

              <div className="space-y-0.5">
                {group.items.map(({ name, href, icon }) => {
                  const Icon = ICONS[icon];
                  const isFeedback = href.startsWith('#');
                  const isActive = isRouteActive(pathname, href);

                  const itemClass = `flex h-9 items-center gap-3 px-4 rounded-full text-body-sm font-medium transition-colors duration-fast ease-soft ${
                    isActive
                      ? 'bg-on-dark text-navy-deep'
                      : 'text-on-dark-muted hover:bg-white/10 hover:text-on-dark'
                  }`;

                  // Обратная связь открывает виджет, а не переходит по адресу.
                  if (isFeedback) {
                    return (
                      <FeedbackTrigger
                        key={name}
                        onClick={onClose}
                        className={`${itemClass} w-full`}
                      >
                        <Icon size={20} className="shrink-0" />
                        {name}
                      </FeedbackTrigger>
                    );
                  }

                  return (
                    <Link
                      key={name}
                      href={href}
                      onClick={onClose}
                      onMouseEnter={() => warmRoute(href)}
                      onFocus={() => warmRoute(href)}
                      onTouchStart={() => warmRoute(href)}
                      className={itemClass}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <Icon size={20} className="shrink-0" />
                      {name}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Подвал сайдбара: только текущий пользователь. Настройки и
            обратная связь переехали в группу «Аккаунт», чтобы не дублироваться. */}
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <Link
              href="/profile"
              onClick={onClose}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-md transition-colors duration-fast ease-soft hover:bg-white/5"
              aria-label="Открыть профиль"
            >
              <UserAvatar
                avatarUrl={session?.avatarUrl}
                frame={session?.avatarFrame}
                name={session?.user?.email ?? undefined}
                className="h-11 w-11 shrink-0"
              />
              <div className="min-w-0">
                <p className="truncate text-body-sm font-medium text-on-dark">
                  {displayNameOf(session?.user?.name || session?.user?.displayName)}
                </p>
                <span className="text-caption text-on-dark-muted">Профиль</span>
              </div>
            </Link>
            <Link
              href="/api/auth/signout"
              className="shrink-0 text-caption text-on-dark-muted transition-colors duration-fast ease-soft hover:text-on-dark"
            >
              Выйти
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}
