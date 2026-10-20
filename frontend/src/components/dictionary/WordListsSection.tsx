'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useApiQuery } from '@/app/lib/use-api';

interface WordList {
  id: number;
  name: string;
  description?: string;
  cefrFrom?: string;
  cefrTo?: string;
  itemCount: number;
  learnedCount: number;
}

export default function WordListsSection() {
  const { data: session } = useSession();

  // Список сборников кэшируется: переключение вкладки «Сборники» больше не грузит его заново
  const {
    data: listsData,
    error: listsError,
    isLoading: listsLoading,
    refresh: refreshLists
  } = useApiQuery<WordList[]>('/api/wordlists', { enabled: Boolean(session) });

  const lists = listsData === undefined ? undefined : Array.isArray(listsData) ? listsData : [];
  const error = lists === undefined && listsError && !listsLoading
    ? 'Не удалось загрузить сборники. Попробуйте обновить страницу.'
    : '';

  if (error) {
    return (
      <div className="card p-12 text-center">
        <p className="text-[var(--color-slate)] mb-4">{error}</p>
        <button onClick={refreshLists} className="btn-secondary">
          Попробовать снова
        </button>
      </div>
    );
  }

  if (lists === undefined) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="card p-6 animate-pulse">
            <div className="h-5 bg-[rgba(201,205,212,0.40)] rounded w-2/3 mb-3"></div>
            <div className="h-4 bg-[rgba(201,205,212,0.40)] rounded w-full mb-2"></div>
            <div className="h-4 bg-[rgba(201,205,212,0.40)] rounded w-4/5 mb-4"></div>
            <div className="h-6 bg-[rgba(201,205,212,0.40)] rounded w-1/3 mb-4"></div>
            <div className="h-2 bg-[rgba(201,205,212,0.40)] rounded w-full mb-2"></div>
            <div className="h-4 bg-[rgba(201,205,212,0.40)] rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (lists.length === 0) {
    return (
      <div className="card p-12 text-center">
        <p className="text-[var(--color-slate)]">Сборники скоро появятся</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {lists.map((list) => {
        const percent = list.itemCount > 0 ? Math.round((list.learnedCount / list.itemCount) * 100) : 0;
        return (
          <div key={list.id} className="card p-6 flex flex-col hover:shadow-md transition-shadow">
            <h3 className="text-lg font-bold text-[var(--color-ink)] mb-2">{list.name}</h3>
            {list.description && (
              <p className="text-sm text-[var(--color-slate)] mb-3 line-clamp-3">{list.description}</p>
            )}
            <div className="flex items-center gap-2 mb-4">
              <span className="badge badge-primary">{list.cefrFrom}–{list.cefrTo}</span>
            </div>
            <div className="mt-auto">
              <div className="flex items-center justify-between text-sm text-[var(--color-slate)] mb-1">
                <span>{list.learnedCount.toLocaleString('ru-RU')} / {list.itemCount.toLocaleString('ru-RU')} изучено</span>
                <span>{percent}%</span>
              </div>
              <div className="h-2 rounded-full bg-[rgba(201,205,212,0.40)] overflow-hidden mb-4">
                <div className="h-full rounded-full bg-[var(--color-primary)] transition-all" style={{ width: `${percent}%` }}></div>
              </div>
              <Link href={`/dictionary/lists/${list.id}`} className="btn-primary w-full text-center">
                Открыть
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
