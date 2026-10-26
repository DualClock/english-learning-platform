import type { ComponentType } from 'react';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import {
  BookmarkIcon,
  BookOpenIcon,
  RepeatIcon,
  StarIcon,
  type IconProps,
} from '@/components/ui/icons';
import { plural, pluralBooks, pluralWords } from '@/lib/plural';
import { MISSING_VALUE, displayCount } from '@/components/dashboard/dashboard-state';

/*
 * Четыре счётчика над планом на сегодня.
 *
 * Правило одно и то же для всех: `null` значит «неизвестно», и рисовать его
 * нулём нельзя. Раньше при упавшем запросе интерфейс уверенно сообщал «0 слов
 * в словаре» — человек делал вывод о себе вместо вывода о связи. Теперь
 * отсутствующее значение показывается прочерком, а подпись не склоняется:
 * «— в словаре» вместо «0 слов в словаре».
 */

interface Props {
  dictCount: number | null;
  reviewCount: number | null;
  booksCount: number | null;
  totalXp?: number | null;
}

interface Stat {
  value: number | null;
  label: string;
  Icon: ComponentType<IconProps>;
}

/** Подпись со склонением, если число известно, и без него — если нет. */
function counterLabel(
  value: number | null,
  pluralize: (n: number) => string,
  missing: string
): string {
  return value === null ? missing : pluralize(value);
}

export default function StatsRow({ dictCount, reviewCount, booksCount, totalXp }: Props) {
  const stats: Stat[] = [
    {
      value: dictCount,
      label: counterLabel(dictCount, (n) => `${pluralWords(n)} в словаре`, 'слов в словаре'),
      Icon: BookOpenIcon,
    },
    {
      value: reviewCount,
      label: counterLabel(reviewCount, (n) => `${pluralWords(n)} на повторении`, 'слов на повторении'),
      Icon: RepeatIcon,
    },
    {
      value: booksCount,
      label: counterLabel(booksCount, (n) => `${pluralBooks(n)} в работе`, 'книг в работе'),
      Icon: BookmarkIcon,
    },
    ...(totalXp !== undefined
      ? [
          {
            value: totalXp,
            label: counterLabel(
              totalXp,
              (n) => `${plural(n, ['балл', 'балла', 'баллов'])} набрано`,
              'баллов набрано'
            ),
            Icon: StarIcon,
          },
        ]
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
            {stat.value === null ? (
              // Прочерк, а не анимированный ноль: анимация 0→0 выглядит как
              // настоящий ноль, то есть как утверждение о данных.
              <span className="block text-h2 text-slate tabular-nums">{MISSING_VALUE}</span>
            ) : (
              /* разряды через AnimatedNumber: тот же формат, что в карточке уровня */
              <AnimatedNumber value={stat.value} className="block text-h2 text-ink tabular-nums" />
            )}
            <span className="block text-body-sm text-slate">{stat.label}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

export { displayCount };
