/**
 * Состав меню и правило подсветки активного пункта.
 *
 * Раньше навигация была плоским списком из 14 пунктов: «Диктант» стоял
 * рядом с «AI Собеседником», и чтобы найти нужное, приходилось читать всё
 * меню. Теперь пункты разложены по смыслу — что человек делает в продукте
 * (учится, тренируется, растёт), а не в каком порядке они появились.
 *
 * Здесь только данные и чистая функция: файл не тянет React и иконки,
 * поэтому проверяется node:test без сборки. Иконки привязываются в
 * Sidebar.tsx по ключу `icon`.
 */

export type NavIconKey =
  | 'home'
  | 'books'
  | 'notebook'
  | 'repeat'
  | 'grammar'
  | 'headphones'
  | 'volume'
  | 'mic'
  | 'pen'
  | 'test'
  | 'trend'
  | 'folders'
  | 'bot'
  | 'user'
  | 'sliders'
  | 'feedback';

export interface NavEntry {
  name: string;
  href: string;
  icon: NavIconKey;
}

export interface NavGroup {
  label: string;
  items: NavEntry[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Учиться',
    items: [
      { name: 'Главная', href: '/dashboard', icon: 'home' },
      { name: 'Библиотека', href: '/books', icon: 'books' },
      { name: 'Словарь', href: '/dictionary', icon: 'notebook' },
    ],
  },
  {
    label: 'Тренироваться',
    items: [
      { name: 'Повторение', href: '/review', icon: 'repeat' },
      { name: 'Грамматика', href: '/grammar', icon: 'grammar' },
      { name: 'Аудирование', href: '/listening', icon: 'headphones' },
      { name: 'Диктант', href: '/practice/dictation', icon: 'volume' },
      { name: 'Произношение', href: '/practice/pronunciation', icon: 'mic' },
      { name: 'Письмо', href: '/writing', icon: 'pen' },
      { name: 'Тест', href: '/quiz', icon: 'test' },
    ],
  },
  {
    label: 'Расти',
    items: [
      { name: 'Прогресс', href: '/progress', icon: 'trend' },
      { name: 'Категории', href: '/categories', icon: 'folders' },
      { name: 'AI Собеседник', href: '/translator', icon: 'bot' },
    ],
  },
  {
    label: 'Аккаунт',
    items: [
      { name: 'Профиль', href: '/profile', icon: 'user' },
      { name: 'Настройки', href: '/settings', icon: 'sliders' },
      // Обратная связь — не переход, а кнопка, открывающая виджет.
      // Живёт в общей группе, чтобы не висеть отдельным блоком над профилем.
      { name: 'Обратная связь', href: '#feedback', icon: 'feedback' },
    ],
  },
];

/** Плоский список маршрутов — для проверок полноты меню. */
export function flatRoutes(): string[] {
  return NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
}

/**
 * Активен ли пункт меню для текущего пути.
 *
 * Сравнение не через голый `startsWith(href)`: иначе `/quiz` загорался бы
 * на `/quiz-archive`, а `/practice/dictation` — на `/practice/dictation-history`.
 * Подстраница засчитывается, только когда после префикса стоит `/`.
 */
export function isRouteActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname || !href || href.startsWith('#')) return false;
  if (pathname === href) return true;
  return pathname.startsWith(href + '/');
}
