import Link from 'next/link';
import type { ComponentType } from 'react';
import {
  BookOpenIcon,
  BotIcon,
  NotebookIcon,
  TestIcon,
  type IconProps,
} from '@/components/ui/icons';

const actions: { href: string; title: string; subtitle: string; Icon: ComponentType<IconProps> }[] =
  [
    { href: '/books', title: 'Библиотека', subtitle: 'Все книги', Icon: BookOpenIcon },
    { href: '/dictionary', title: 'Словарь', subtitle: 'Твои слова', Icon: NotebookIcon },
    { href: '/quiz', title: 'Тест', subtitle: 'Проверить знания', Icon: TestIcon },
    { href: '/translator', title: 'AI Собеседник', subtitle: 'Поговорить по-английски', Icon: BotIcon },
  ];

export default function QuickActions() {
  return (
    <section>
      <h2 className="mb-4 text-h3 text-ink">Быстрые действия</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="card-interactive group p-4"
          >
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-surface-accent text-primary transition-colors duration-fast ease-soft group-hover:bg-primary group-hover:text-on-primary">
              <action.Icon size={20} />
            </span>
            <span className="block text-body-sm font-medium text-ink">{action.title}</span>
            <span className="mt-0.5 block text-caption text-slate">{action.subtitle}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
