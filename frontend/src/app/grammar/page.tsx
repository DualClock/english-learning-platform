'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useApiQuery } from '@/app/lib/use-api';

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
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-[var(--color-ink)] mb-2">Грамматика</h1>
        <p className="text-[var(--color-slate)] mb-8">
          Учи грамматику короткими уроками: теория + практика
        </p>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-xl border border-[var(--color-hairline-strong)] p-6 animate-pulse"
              >
                <div className="h-4 w-16 bg-[var(--color-tint-mint)] rounded mb-4" />
                <div className="h-5 w-3/4 bg-[var(--color-tint-mint)] rounded mb-3" />
                <div className="h-4 w-full bg-[var(--color-tint-mint)] rounded mb-2" />
                <div className="h-4 w-2/3 bg-[var(--color-tint-mint)] rounded mb-6" />
                <div className="h-9 w-24 bg-[var(--color-tint-mint)] rounded-lg" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-[var(--color-hairline-strong)] p-8 text-center">
            <p className="text-[var(--color-ink)] mb-4">{error}</p>
            <button onClick={refreshUnits} className="btn-primary">
              Попробовать снова
            </button>
          </div>
        ) : units.length === 0 ? (
          <div className="bg-white rounded-xl border border-[var(--color-hairline-strong)] p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[var(--color-tint-mint)] flex items-center justify-center">
              <svg
                className="w-8 h-8 text-[var(--color-slate)]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M12 6.2C10.4 4.8 8.4 4.2 6 4.2c-1 0-2 .1-3 .4v13.9c1-.3 2-.4 3-.4 2.4 0 4.4.6 6 2 1.6-1.4 3.6-2 6-2 1 0 2 .1 3 .4V4.6c-1-.3-2-.4-3-.4-2.4 0-4.4.6-6 2zm0 0v13.9"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-[var(--color-ink)] mb-2">
              Юниты скоро появятся
            </h2>
            <p className="text-[var(--color-slate)]">
              Мы уже готовим для тебя уроки грамматики
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {sections.map(([section, sectionUnits]) => (
              <div key={section}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-lg font-semibold text-[var(--color-ink)]">
                    {section}
                  </h2>
                  <span className="text-xs text-[var(--color-slate)]">
                    {sectionUnits.length}{' '}
                    {sectionUnits.length === 1
                      ? 'юнит'
                      : sectionUnits.length < 5
                        ? 'юнита'
                        : 'юнитов'}
                  </span>
                  <div className="flex-1 h-px bg-[var(--color-hairline-strong)]" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger">
                  {sectionUnits.map((unit) => (
                    <div
                      key={unit.id}
                      className="bg-white rounded-xl border border-[var(--color-hairline-strong)] p-6 flex flex-col"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-8 h-8 shrink-0 rounded-full bg-[var(--color-tint-mint)] text-[var(--color-primary)] text-sm font-semibold flex items-center justify-center">
                            {unit.order}
                          </span>
                          <span className="badge badge-primary text-xs">
                            {unit.cefrLevel}
                          </span>
                        </div>
                        {unit.completed ? (
                          <span className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)]">
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            Пройден · {unit.score}%
                          </span>
                        ) : (
                          <span className="shrink-0 text-sm text-[var(--color-slate)]">
                            Не пройден
                          </span>
                        )}
                      </div>

                      <h3 className="text-lg font-semibold text-[var(--color-ink)] mb-1">
                        {unit.title}
                      </h3>
                      <p className="text-sm text-[var(--color-slate)] mb-5 flex-1">
                        {unit.shortDescription}
                      </p>

                      <Link
                        href={`/grammar/${unit.id}`}
                        className="btn-primary self-start !py-2 !px-5 text-sm"
                      >
                        Открыть
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
