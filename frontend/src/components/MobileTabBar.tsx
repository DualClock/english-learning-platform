'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BooksIcon, HomeIcon, NotebookIcon, RepeatIcon, TrendUpIcon } from './ui/icons';
import { isRouteActive } from '@/lib/sidebar-nav';

/**
 * Нижняя навигация на телефоне.
 *
 * До этого на мобиле был только гамбургер в шапке: чтобы перейти между
 * библиотекой, словарём и повторением, нужно было открыть drawer и найти
 * пункт в списке из 16 строк. Пять главных разделов вынесены в постоянную
 * панель — они же первые три пункта группы «Учиться» и начало
 * «Тренироваться», то есть повседневный маршрут чтения.
 *
 * Панель живёт только на узких экранах (`lg:hidden`); на десктопе её роль
 * играет сайдбар. Высота 56px + safe-area, поэтому AppLayout обязан держать
 * нижний отступ у контента — иначе панель перекроет последний блок страницы.
 */

const TABS = [
  { name: 'Главная', href: '/dashboard', Icon: HomeIcon },
  { name: 'Библиотека', href: '/books', Icon: BooksIcon },
  { name: 'Словарь', href: '/dictionary', Icon: NotebookIcon },
  { name: 'Повторение', href: '/review', Icon: RepeatIcon },
  { name: 'Прогресс', href: '/progress', Icon: TrendUpIcon },
];

export default function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Основные разделы"
    >
      <ul className="flex">
        {TABS.map(({ name, href, Icon }) => {
          const isActive = isRouteActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] leading-tight transition-colors duration-fast ease-soft ${
                  isActive ? 'text-primary' : 'text-slate hover:text-ink'
                }`}
              >
                <Icon size={20} className="shrink-0" />
                <span className="truncate px-0.5">{name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
