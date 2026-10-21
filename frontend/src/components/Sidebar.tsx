'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { resolveAvatarSrc } from '@/app/lib/avatars';
import { prefetchApi } from '@/app/lib/api-client';
import { useCallback, type ComponentType } from 'react';
import {
  BookOpenIcon,
  BooksIcon,
  BotIcon,
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
  '/grammar': ['/api/grammar/units'],
  '/translator': ['/api/profile'],
  '/writing': ['/api/profile'],
  '/practice/dictation': ['/api/practice/dictation?count=5'],
  '/practice/pronunciation': ['/api/practice/minimal-pairs'],
  '/settings': ['/api/profile'],
};

const navigation: { name: string; href: string; Icon: ComponentType<IconProps> }[] = [
  { name: 'Главная', href: '/dashboard', Icon: HomeIcon },
  { name: 'Библиотека', href: '/books', Icon: BooksIcon },
  { name: 'Словарь', href: '/dictionary', Icon: NotebookIcon },
  { name: 'Категории', href: '/categories', Icon: FoldersIcon },
  { name: 'Повторение', href: '/review', Icon: RepeatIcon },
  { name: 'Прогресс', href: '/progress', Icon: TrendUpIcon },
  { name: 'Грамматика', href: '/grammar', Icon: BookOpenIcon },
  { name: 'Тест', href: '/quiz', Icon: TestIcon },
  { name: 'Аудирование', href: '/practice/dictation', Icon: HeadphonesIcon },
  { name: 'Произношение', href: '/practice/pronunciation', Icon: MicIcon },
  { name: 'Письмо', href: '/writing', Icon: PenIcon },
  { name: 'AI Собеседник', href: '/translator', Icon: BotIcon },
];

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
    `flex items-center gap-3 px-4 py-2.5 rounded-full text-body-sm font-medium transition-colors duration-fast ease-soft ${
      isActive
        ? 'bg-on-dark text-navy-deep'
        : 'text-on-dark-muted hover:bg-white/10 hover:text-on-dark'
    }`;

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
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
          {navigation.map(({ name, href, Icon }) => {
            const isActive = pathname === href || pathname?.startsWith(href + '/');

            return (
              <Link
                key={name}
                href={href}
                onClick={onClose}
                onMouseEnter={() => warmRoute(href)}
                onFocus={() => warmRoute(href)}
                onTouchStart={() => warmRoute(href)}
                className={linkClass(isActive)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={20} className="shrink-0" />
                {name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 pt-2">
          <Link
            href="/settings"
            onClick={onClose}
            className={`${linkClass(pathname === '/settings')} mb-3`}
            aria-current={pathname === '/settings' ? 'page' : undefined}
          >
            <SlidersIcon size={20} className="shrink-0" />
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
              <p className="text-body-sm font-medium text-on-dark truncate">
                {session?.user?.email}
              </p>
              <Link
                href="/api/auth/signout"
                className="text-caption text-on-dark-muted hover:text-on-dark transition-colors duration-fast ease-soft"
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
