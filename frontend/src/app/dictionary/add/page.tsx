'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import AddWordForm from '@/components/dictionary/AddWordForm';
import BulkAddForm from '@/components/dictionary/BulkAddForm';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import {
  ArrowLeftIcon,
  NotebookIcon,
  PenIcon,
  UserIcon,
} from '@/components/ui/icons';

type AddMode = 'single' | 'bulk';

const TABS: { id: AddMode; label: string; icon: typeof PenIcon }[] = [
  { id: 'single', label: 'Одно слово', icon: PenIcon },
  { id: 'bulk', label: 'Списком', icon: NotebookIcon },
];

export default function AddWordPage() {
  const { status } = useSession();
  const [mode, setMode] = useState<AddMode>('single');
  const [bulkRunning, setBulkRunning] = useState(false);

  const selectTab = (next: AddMode) => {
    if (bulkRunning) return;
    setMode(next);
    requestAnimationFrame(() => document.getElementById(`add-tab-${next}`)?.focus());
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: AddMode) => {
    if (bulkRunning) return;
    const index = TABS.findIndex((tab) => tab.id === current);
    let nextIndex = index;

    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;

    event.preventDefault();
    selectTab(TABS[nextIndex].id);
  };

  if (status === 'unauthenticated') {
    return (
      <AppLayout>
        <EmptyState
          icon={<UserIcon size={24} />}
          title="Нужен аккаунт"
          description="Чтобы добавлять слова в словарь, войдите — словарь привязан к профилю."
          action={
            <Button href="/login" variant="primary">
              Войти
            </Button>
          }
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl">
        <Button href="/dictionary" variant="ghost" className="mb-3">
          <ArrowLeftIcon size={16} />
          К словарю
        </Button>

        <PageHeader
          title="Добавить слово"
          subtitle="Одно слово или целый список. Перевод можно подставить AI, вписать вручную или оставить на потом."
        />

        <div
          role="tablist"
          aria-label="Способ добавления слов"
          className="mb-6 mt-5 inline-flex rounded-lg border border-hairline bg-surface-sunken p-1"
        >
          {TABS.map((tab) => {
            const active = mode === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                id={`add-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`add-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                disabled={bulkRunning}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, tab.id)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-md px-4 py-2 text-body-sm font-medium transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-slate hover:text-ink'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div
          id="add-panel-single"
          role="tabpanel"
          aria-labelledby="add-tab-single"
          hidden={mode !== 'single'}
        >
          {mode === 'single' && <AddWordForm />}
        </div>

        <div
          id="add-panel-bulk"
          role="tabpanel"
          aria-labelledby="add-tab-bulk"
          hidden={mode !== 'bulk'}
        >
          {mode === 'bulk' && <BulkAddForm onRunningChange={setBulkRunning} />}
        </div>

        <p className="mt-6 max-w-measure text-caption text-slate">
          Слова из книг можно добавлять прямо в читалке — нажмите на незнакомое слово и «В словарь».
          Готовые подборки есть в{' '}
          <Link href="/dictionary?tab=lists" className="text-primary hover:underline">
            сборниках
          </Link>
          .
        </p>
      </div>
    </AppLayout>
  );
}
