'use client';

import AppLayout from '@/components/AppLayout';
import { useSession } from 'next-auth/react';
import { useApiQuery } from '@/app/lib/use-api';
import { pluralUnits } from '@/lib/plural';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LevelChip from '@/components/ui/LevelChip';
import PageHeader from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/LoadingState';
import { CheckIcon, BookOpenIcon } from '@/components/ui/icons';

interface GrammarUnit {
  id: number;
  order: number;
  title: string;
  cefrLevel: string;
  section?: string | null;
  shortDescription: string;
  completed: boolean;
  score: number;
}

export default function GrammarPage() {
  const { status } = useSession();

  const {
    data: unitsData,
    error: unitsError,
    isLoading: unitsLoading,
    refresh: refreshUnits,
  } = useApiQuery<GrammarUnit[]>('/api/grammar/units', {
    enabled: status === 'authenticated',
  });

  const units = unitsData ?? [];
  const isLoading = unitsLoading && unitsData === undefined;
  // Ошибку показываем только если данных ещё нет: при фоновом обновлении
  // уже загруженный список не должен заменяться экраном ошибки.
  const error =
    unitsError && unitsData === undefined
      ? 'Не удалось загрузить юниты. Проверь соединение и попробуй ещё раз.'
      : null;

  // Группировка юнитов по разделам в порядке порядка юнитов
  const sections = (() => {
    const map = new Map<string, GrammarUnit[]>();
    for (const unit of [...units].sort((a, b) => a.order - b.order)) {
      const key = unit.section?.trim() || 'Другое';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(unit);
    }
    return Array.from(map.entries());
  })();

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Грамматика"
          subtitle="Учи грамматику короткими уроками: теория + практика"
        />

        {isLoading ? (
          <GrammarSkeleton />
        ) : error ? (
          <ErrorState
            title="Юниты не загрузились"
            description={error}
            onRetry={refreshUnits}
            action={<Button variant="ghost" href="/dashboard">На главную</Button>}
          />
        ) : units.length === 0 ? (
          <EmptyState
            icon={<BookOpenIcon size={24} />}
            title="Юниты скоро появятся"
            description="Мы уже готовим для тебя уроки грамматики."
            action={<Button variant="secondary" href="/dashboard">На главную</Button>}
          />
        ) : (
          <div className="mt-8 space-y-10">
            {sections.map(([section, sectionUnits]) => (
              <section key={section}>
                <div className="mb-4 flex items-center gap-3">
                  <h2 className="text-h3 text-ink">{section}</h2>
                  <span className="text-caption text-slate">
                    {sectionUnits.length} {pluralUnits(sectionUnits.length)}
                  </span>
                  <div className="h-px flex-1 bg-hairline" />
                </div>
                <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2">
                  {sectionUnits.map((unit) => (
                    <article key={unit.id} className="card flex flex-col">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-accent text-body-sm font-semibold tabular-nums text-on-accent">
                            {unit.order}
                          </span>
                          <LevelChip level={unit.cefrLevel} />
                        </div>
                        {unit.completed ? (
                          <span className="inline-flex shrink-0 items-center gap-1.5 text-body-sm font-medium text-primary">
                            <CheckIcon size={16} />
                            Пройден · <span className="tabular-nums">{unit.score}%</span>
                          </span>
                        ) : (
                          <span className="shrink-0 text-body-sm text-slate">Не пройден</span>
                        )}
                      </div>

                      <h3 className="mb-1 text-h3 text-ink">{unit.title}</h3>
                      <p className="mb-5 flex-1 text-body-sm text-slate">{unit.shortDescription}</p>

                      <Button href={`/grammar/${unit.id}`} className="self-start">
                        Открыть
                      </Button>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

/** Скелет повторяет сетку юнитов: два ряда карточек с шапкой раздела. */
function GrammarSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-8">
      <span className="sr-only">Загрузка юнитов грамматики</span>
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card flex flex-col">
            <div className="mb-4 flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
            <Skeleton className="mb-2 h-5 w-3/4" />
            <Skeleton className="mb-5 h-4 w-full" />
            <Skeleton className="h-9 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
