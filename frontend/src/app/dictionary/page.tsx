'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import WordListsSection from '@/components/dictionary/WordListsSection';
import DictionarySkeleton from '@/components/dictionary/DictionarySkeleton';
import Pager from '@/components/Pager';
import { useSpeech } from '@/hooks/useSpeech';
import { useApiQuery } from '@/app/lib/use-api';
import { apiMutate } from '@/app/lib/api-client';
import { isPaged, type Paged } from '@/app/lib/paged';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import {
  AlertIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  VolumeIcon,
} from '@/components/ui/icons';
import { transition } from '@/lib/motion';
import { pluralWords } from '@/lib/plural';
import { formatNumber } from '@/lib/format';

interface Word {
  id: number;
  text: string;
  language?: string;
  definitions: {
    id: number;
    definition: string;
    partOfSpeech?: string;
    example?: string;
  }[];
  createdAt: string;
}

function DictionaryTabs() {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'lists' ? 'lists' : 'my';

  const tabs = [
    { key: 'my', label: 'Мой словарь' },
    { key: 'lists', label: 'Сборники' }
  ];

  return (
    <nav aria-label="Разделы словаря" className="mb-6 flex gap-6">
      {tabs.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.key === 'my' ? '/dictionary' : '/dictionary?tab=lists'}
            aria-current={active ? 'page' : undefined}
            className={`relative px-1 pb-2.5 text-body-sm font-medium transition-colors duration-fast ${
              active ? 'text-primary' : 'text-slate hover:text-ink'
            }`}
          >
            {tab.label}
            {active && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}
          </Link>
        );
      })}
    </nav>
  );
}

function DictionaryContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'lists' ? 'lists' : 'my';

  const [searchQuery, setSearchQuery] = useState('');
  // Применённый поиск: пустая строка — показываем весь словарь
  const [appliedQuery, setAppliedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState('');

  const wordsPath = appliedQuery
    ? `/api/dictionary/search?query=${encodeURIComponent(appliedQuery)}`
    : `/api/dictionary?page=${page}&pageSize=50`;

  // Словарь берётся из общего кэша: повторный заход на вкладку рисуется сразу.
  // Основной список приходит пагинированным конвертом, поиск — плоским массивом.
  const {
    data: wordsData,
    error: wordsError,
    isLoading: wordsLoading,
    refresh: refreshWords
  } = useApiQuery<Paged<Word> | Word[]>(
    wordsPath,
    { enabled: status === 'authenticated' }
  );

  const paged = isPaged<Word>(wordsData) ? wordsData : null;
  const words: Word[] = paged ? paged.items : Array.isArray(wordsData) ? wordsData : [];
  const totalCount = paged ? paged.totalCount : words.length;
  const totalPages = paged ? paged.totalPages : 1;
  const isInitialLoading = wordsLoading && wordsData === undefined;
  const loadError = wordsError ? (appliedQuery ? 'Ошибка поиска' : 'Ошибка загрузки слов') : '';
  // Ошибка загрузки показывается баннером только если слова на экране остались:
  // пустой список с той же ошибкой — это уже состояние ErrorState.
  const bannerError = actionError || (words.length > 0 ? loadError : '');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const searchWords = () => {
    const nextQuery = searchQuery.trim();

    if (!nextQuery) {
      setAppliedQuery('');
      setPage(1);
      // Повторный клик без запроса — принудительно обновляем словарь
      if (!appliedQuery) refreshWords();
      return;
    }

    if (nextQuery === appliedQuery) {
      refreshWords();
      return;
    }

    setPage(1);
    setAppliedQuery(nextQuery);
  };

  const deleteWord = async (id: number) => {
    if (!confirm('Удалить это слово?')) return;

    setActionError('');
    try {
      await apiMutate(`/api/dictionary/${id}`, {
        token: session?.accessToken,
        method: 'DELETE',
        invalidate: ['/api/dictionary']
      });

      // Кэш уже сброшен — забираем актуальный список из сети
      refreshWords();
    } catch {
      setActionError('Ошибка удаления');
    }
  };

  const { speak } = useSpeech();

  if (status === 'loading' || (activeTab === 'my' && isInitialLoading)) {
    return (
      <AppLayout>
        <DictionarySkeleton />
      </AppLayout>
    );
  }

  if (activeTab === 'lists') {
    return (
      <AppLayout>
        <PageHeader title="Словарь" subtitle="Готовые сборники слов по уровням и темам" />
        <Suspense fallback={null}>
          <DictionaryTabs />
        </Suspense>
        <WordListsSection />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Словарь"
        subtitle={`${formatNumber(totalCount)} ${pluralWords(totalCount)} сохранено`}
        actions={
          <Button href="/dictionary/add" variant="primary">
            <PlusIcon size={16} />
            Добавить слово
          </Button>
        }
      />

      <Suspense fallback={null}>
        <DictionaryTabs />
      </Suspense>

      {/* Поиск и добавление */}
      <div className="card mb-6 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <label htmlFor="dictionary-search" className="sr-only">
              Поиск слов в словаре
            </label>
            <SearchIcon
              size={20}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate"
            />
            <input
              id="dictionary-search"
              type="search"
              placeholder="Поиск слов..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchWords()}
              className="input pl-10"
            />
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={searchWords} className="flex-1 sm:flex-none">
              Найти
            </Button>
          </div>
        </div>
      </div>

      {bannerError && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-semantic-error bg-surface-danger p-4 text-body-sm text-on-danger"
        >
          <span className="flex items-center gap-2">
            <AlertIcon size={20} />
            {bannerError}
          </span>
          <Button variant="secondary" onClick={() => { setActionError(''); refreshWords(); }}>
            Попробовать снова
          </Button>
        </div>
      )}

      {/* Список слов */}
      {loadError && words.length === 0 ? (
        <ErrorState
          title="Словарь не загрузился"
          description={appliedQuery
            ? 'Поиск не выполнился: сервер не ответил. Попробуйте ещё раз.'
            : 'Сохранённые слова не пришли с сервера. Проверьте соединение и повторите.'}
          onRetry={refreshWords}
        />
      ) : words.length === 0 ? (
        <EmptyState
          icon={appliedQuery ? <SearchIcon size={24} /> : undefined}
          lexi={appliedQuery ? undefined : 'read'}
          title={appliedQuery ? 'Ничего не нашлось' : 'В словаре пока пусто'}
          description={appliedQuery
            ? `Слова «${appliedQuery}» в вашем словаре нет.`
            : 'Сохрани первое слово в читалке — оно появится здесь.'}
          action={
            appliedQuery ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchQuery('');
                  setAppliedQuery('');
                  setPage(1);
                }}
              >
                Сбросить поиск
              </Button>
            ) : (
              <Button href="/dictionary/add" variant="primary">
                <PlusIcon size={16} />
                Добавить первое слово
              </Button>
            )
          }
        />
      ) : (
        <motion.ul className="stagger space-y-3" initial={false}>
          <AnimatePresence initial={false}>
            {words.map((word) => (
              <motion.li
                key={word.id}
                exit={{ opacity: 0, x: -12, transition: transition.fast }}
                className="card flex items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => speak(word.text)}
                      className="text-body-lg font-semibold text-ink transition-colors duration-fast hover:text-primary"
                    >
                      {word.text}
                    </button>
                    <button
                      onClick={() => speak(word.text)}
                      className="icon-chip h-8 min-w-8 px-2"
                      title="Произнести"
                      aria-label={`Произнести ${word.text}`}
                    >
                      <VolumeIcon size={16} />
                    </button>
                    {word.definitions[0]?.partOfSpeech && (
                      <Badge tone="neutral">{word.definitions[0].partOfSpeech}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-body-sm text-slate">{word.definitions[0]?.definition}</p>
                  {word.definitions[0]?.example && (
                    <p className="mt-1 text-body-sm italic text-slate">«{word.definitions[0].example}»</p>
                  )}
                </div>
                <button
                  onClick={() => deleteWord(word.id)}
                  className="icon-chip h-10 w-10 shrink-0 border-transparent bg-transparent text-semantic-error hover:bg-surface-danger"
                  title="Удалить слово"
                  aria-label={`Удалить ${word.text}`}
                >
                  <TrashIcon size={20} />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      {!appliedQuery && (
        <Pager
          page={page}
          totalPages={totalPages}
          onPageChange={(next) => {
            setPage(next);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
    </AppLayout>
  );
}

export default function DictionaryPage() {
  return (
    <Suspense fallback={
      <AppLayout>
        <DictionarySkeleton />
      </AppLayout>
    }>
      <DictionaryContent />
    </Suspense>
  );
}
