'use client';

import { useMemo, useState } from 'react';
import ActivityHeatmap, {
  type ActivityDay,
} from '@/components/ui/activity-heatmap';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { plural } from '@/lib/plural';

const DAY = 86_400_000;

/**
 * Данные детерминированные: витрина должна выглядеть одинаково на каждом
 * прогоне, иначе скриншоты нельзя сравнивать между собой.
 */
function generateDays(): ActivityDay[] {
  const days: ActivityDay[] = [];
  const end = new Date('2025-12-31T00:00:00Z');
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
    const weekday = new Date(t).getUTCDay();
    // Выходные тише будней: без этого ритма сетка читается как шум
    const weight = weekday === 0 || weekday === 6 ? 0.5 : 1;
    const roll = rand();
    const count =
      roll > 0.78
        ? Math.round(roll * 18 * weight)
        : roll > 0.45
          ? Math.round(roll * 7 * weight)
          : 0;
    days.push({ date: new Date(t).toISOString().slice(0, 10), count });
  }
  return days;
}

const RANGES = [
  { id: 'year', label: 'Год', days: 365, period: 'за год', labelForGrid: 'Минуты чтения за год' },
  { id: 'half', label: 'Полгода', days: 183, period: 'за полгода', labelForGrid: 'Минуты чтения за полгода' },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export default function HeatmapLabPage() {
  const all = useMemo(generateDays, []);
  const [range, setRange] = useState<RangeId>('year');
  const [selected, setSelected] = useState<string | null>(null);

  const current = RANGES.find((item) => item.id === range) ?? RANGES[0];
  const days = useMemo(
    () => (range === 'year' ? all : all.slice(-current.days)),
    [all, range, current.days],
  );

  const selectedCount = selected
    ? (all.find((day) => day.date === selected)?.count ?? 0)
    : 0;

  return (
    <main className="min-h-screen bg-surface px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <PageHeader
          title="Activity heatmap"
          subtitle="Календарь активности в стиле contribution-графа: ритм, серии и тихие недели видны сразу. Витрина дизайн-системы, продакшен-маршрут отвечает 404."
        />

        <Card>
          <ActivityHeatmap
            days={days}
            label={current.labelForGrid}
            period={current.period}
            unit={{ one: 'минута', few: 'минуты', other: 'минут' }}
            locale="ru-RU"
            selectedDate={selected}
            onSelectDate={setSelected}
            actions={
              <div
                className="flex items-center gap-1.5"
                role="group"
                aria-label="Диапазон"
              >
                {RANGES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      range === item.id ? 'chip-button-active' : 'chip-button'
                    }
                    aria-pressed={range === item.id}
                    onClick={() => {
                      setRange(item.id);
                      // Выбор вне нового диапазона оставил бы кольцо «в никуда»
                      setSelected(null);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            }
          />
        </Card>

        <div className="mt-4 flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-hairline bg-canvas px-4 py-3">
          <span className="text-caption text-steel">Выбранный день</span>
          {selected ? (
            <>
              <span className="text-body-sm font-medium text-ink">
                {dateFormat.format(new Date(`${selected}T00:00:00Z`))}
              </span>
              <span className="badge-tag-teal">
                {selectedCount} {plural(selectedCount, ['минута', 'минуты', 'минут'])}
              </span>
            </>
          ) : (
            <span className="text-body-sm text-slate">
              Клетка ещё не выбрана — нажми на день или дойди до него стрелками
              и нажми Enter.
            </span>
          )}
        </div>

        <p className="mt-3 max-w-measure text-caption text-steel">
          Стрелки ходят по дням и неделям, Home и End прыгают к краям
          диапазона. Наведение или фокус на свотче легенды подсвечивает дни
          этого уровня, клик закрепляет подсветку.
        </p>
      </div>
    </main>
  );
}
