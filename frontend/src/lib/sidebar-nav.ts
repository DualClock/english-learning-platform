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
  | 'feedback'
  | 'shield';

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
 * Пункты админки. Отдельно от NAV_GROUPS, потому что зависят от роли, а
 * NAV_GROUPS — статический состав меню обычного человека.
 *
 * Живут в данных, а не в компоненте: меню проверяется node:test без сборки,
 * и правило «админ видит админку, остальные — нет» должно быть проверяемым.
 */
export const ADMIN_NAV_GROUP: NavGroup = {
  label: 'Админка',
  items: [
    { name: 'Категории и слова', href: '/admin/content/categories', icon: 'folders' },
    { name: 'Статьи', href: '/admin/content/articles', icon: 'pen' },
    { name: 'Книги', href: '/admin/content', icon: 'books' },
  ],
};

/**
 * Меню для конкретного человека: обычные группы плюс админские, если роль
 * Admin есть в сессии.
 *
 * Админская группа ставится ПЕРВОЙ, а не последней. Меню обычного человека
 * занимает почти всю высоту окна, и внизу ссылка оказывалась за пределами
 * прокрутки: человек входил админом, видел обычное меню и решал, что функций
 * админа нет. Первый блок виден без прокрутки всегда.
 *
 * Это только навигация. Доступ закрывает middleware по роли и сам бэкенд
 * через [Authorize(Roles = "Admin")] — скрытый пункт защитой не является.
 */
export function navGroupsFor(roles: readonly string[] | null | undefined): NavGroup[] {
  const isAdmin = Array.isArray(roles) && roles.includes('Admin');
  return isAdmin ? [ADMIN_NAV_GROUP, ...NAV_GROUPS] : NAV_GROUPS;
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
