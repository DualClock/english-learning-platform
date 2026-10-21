'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useApiQuery } from '@/app/lib/use-api';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Button from '@/components/ui/Button';
import LevelChip from '@/components/ui/LevelChip';
import ProgressBar from '@/components/ui/ProgressBar';
import { Skeleton } from '@/components/ui/LoadingState';
import { ArrowRightIcon, FoldersIcon } from '@/components/ui/icons';

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

  if (lists === undefined) {
    if (listsError && !listsLoading) {
      return (
        <ErrorState
          title="Сборники не загрузились"
          description="Список готовых сборников не пришёл с сервера. Попробуйте обновить."
          onRetry={refreshLists}
        />
      );
    }
    return (
      <div role="status" aria-busy="true" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <span className="sr-only">Загрузка сборников</span>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="card flex flex-col p-6">
            <Skeleton className="mb-3 h-5 w-2/3" />
            <Skeleton className="mb-2 h-4 w-full" />
            <Skeleton className="mb-4 h-4 w-4/5" />
            <Skeleton className="mb-4 h-6 w-20" />
            <Skeleton className="mb-2 h-2 w-full rounded-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (lists.length === 0) {
    return (
      <EmptyState
        icon={<FoldersIcon size={24} />}
        title="Сборников пока нет"
        description="Готовые списки слов по уровням и темам появятся здесь. А пока можно собирать словарь самому — из читалки или вручную."
        action={
          <Button href="/dictionary/add" variant="secondary">
            Добавить своё слово
          </Button>
        }
      />
    );
  }

  return (
    <div className="stagger grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {lists.map((list) => {
        const percent = list.itemCount > 0 ? Math.round((list.learnedCount / list.itemCount) * 100) : 0;
        return (
          <Link key={list.id} href={`/dictionary/lists/${list.id}`} className="card-interactive flex flex-col p-6">
            <h3 className="mb-2 text-h3 text-ink">{list.name}</h3>
            {list.description && (
              <p className="mb-4 line-clamp-3 text-body text-slate">{list.description}</p>
            )}
            {list.cefrFrom && list.cefrTo && (
              <div className="mb-4">
                <LevelChip level={list.cefrFrom}>{list.cefrFrom}–{list.cefrTo}</LevelChip>
              </div>
            )}
            <div className="mt-auto">
              <div className="mb-1.5 flex items-center justify-between text-caption text-slate">
                <span className="tabular-nums">
                  {list.learnedCount.toLocaleString('ru-RU')} / {list.itemCount.toLocaleString('ru-RU')} изучено
                </span>
                <span className="font-semibold tabular-nums text-primary">{percent}%</span>
              </div>
              <ProgressBar value={percent} label={`Изучено из сборника «${list.name}»`} className="mb-4" />
              <span className="inline-flex items-center gap-1.5 text-body-sm font-medium text-primary">
                Открыть
                <ArrowRightIcon size={16} />
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
