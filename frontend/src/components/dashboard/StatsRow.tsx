import type { ComponentType } from 'react';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import {
  BookmarkIcon,
  BookOpenIcon,
  RepeatIcon,
  StarIcon,
  type IconProps,
} from '@/components/ui/icons';
import { pluralize } from './utils';

interface Props {
  dictCount: number | null;
  reviewCount: number;
  booksCount: number;
  totalXp?: number | null;
}

interface Stat {
  value: number;
  label: string;
  Icon: ComponentType<IconProps>;
}

export default function StatsRow({ dictCount, reviewCount, booksCount, totalXp }: Props) {
  const stats: Stat[] = [
    ...(dictCount !== null
      ? [{ value: dictCount, label: pluralize(dictCount, 'слово', 'слова', 'слов') + ' в словаре', Icon: BookOpenIcon }]
      : []),
    { value: reviewCount, label: pluralize(reviewCount, 'слово', 'слова', 'слов') + ' на повторении', Icon: RepeatIcon },
    { value: booksCount, label: pluralize(booksCount, 'книга', 'книги', 'книг') + ' в работе', Icon: BookmarkIcon },
    ...(totalXp !== null && totalXp !== undefined
      ? [{ value: totalXp, label: 'баллов набрано', Icon: StarIcon }]
      : []),
  ];

  return (
    <section className="stagger mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="card flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-surface-accent text-primary">
            <stat.Icon size={20} />
          </span>
          <span className="min-w-0">
            {/* разряды через AnimatedNumber: тот же формат, что в карточке уровня */}
            <AnimatedNumber value={stat.value} className="block text-h2 text-ink tabular-nums" />
            <span className="block text-body-sm text-slate">{stat.label}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
