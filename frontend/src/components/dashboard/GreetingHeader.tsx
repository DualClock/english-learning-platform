import { Tag } from '@/components/ui/Badge';
import { TargetIcon } from '@/components/ui/icons';
import Link from 'next/link';

interface Props {
  name?: string | null;
  level?: string | null;
}

export default function GreetingHeader({ name, level }: Props) {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour >= 5 && hour < 12
      ? 'Доброе утро'
      : hour >= 12 && hour < 18
        ? 'Добрый день'
        : hour >= 18 && hour < 23
          ? 'Добрый вечер'
          : 'Доброй ночи';

  const dateStr = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);

  return (
    <header className="mb-10 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-caption text-slate">{dateStr}</p>
        <h1 className="mt-1 text-h1 text-ink">
          {greeting}, {name?.trim() || 'друг'}
        </h1>
        <p className="mt-2 max-w-measure text-body text-charcoal">
          Немного чтения каждый день — и словарный запас растёт сам.
        </p>
      </div>

      {level ? (
        <span title="Пересдать тест можно в настройках">
          <Tag tone="warning">Уровень: {level.toUpperCase()}</Tag>
        </span>
      ) : (
        <Link
          href="/settings"
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-hairline-strong bg-canvas px-3 py-1.5 text-caption font-semibold text-primary transition-colors duration-fast ease-soft hover:border-primary hover:bg-surface-accent"
        >
          <TargetIcon size={16} />
          Определить уровень
        </Link>
      )}
    </header>
  );
}
