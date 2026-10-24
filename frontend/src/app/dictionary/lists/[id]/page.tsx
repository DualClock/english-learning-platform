'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useApiQuery } from '@/app/lib/use-api';
import { apiMutate } from '@/app/lib/api-client';
import { useTts } from '@/hooks/useTts';
import Pager from '@/components/Pager';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/LoadingState';
import LevelChip from '@/components/ui/LevelChip';
import Button from '@/components/ui/Button';
import { Tag } from '@/components/ui/Badge';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CheckIcon,
  SpinnerIcon,
  VolumeIcon,
} from '@/components/ui/icons';
import { pluralWords } from '@/lib/plural';
import { formatNumber } from '@/lib/format';
import { variants } from '@/lib/motion';

interface ListItem {
  wordText: string;
  cefrLevel: string;
  freqRank: number;
  inDictionary: boolean;
}

interface ListDetail {
  id: number;
  name: string;
  description?: string;
  cefrFrom?: string;
  cefrTo?: string;
  items: ListItem[];
  totalItems: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 50;

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Возврат к сборникам — это навигация, поэтому ссылка, а не обработчик клика. */
function BackToDictionary() {
  return (
    <Button href="/dictionary?tab=lists" variant="ghost" className="mb-4">
      <ArrowLeftIcon size={16} />
      Назад к словарю
    </Button>
  );
}

export default function WordListPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { speak } = useTts();
  const params = useParams();
  const listId = params?.id as string;

  const [page, setPage] = useState(1);
  const [learnError, setLearnError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLearning, setIsLearning] = useState(false);
  const [notice, setNotice] = useState<{ added: number; skipped: number } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [practiceLevels, setPracticeLevels] = useState<Set<string>>(new Set());
  const [practiceCount, setPracticeCount] = useState(20);

  const listPath = listId
    ? `/api/wordlists/${listId}?page=${page}&pageSize=${PAGE_SIZE}`
    : null;

  // Страница сборника кэшируется по page/pageSize: возврат на страницу — мгновенный
  const {
    data: list,
    error: listError,
    isLoading: listLoading,
    refresh: refreshList
  } = useApiQuery<ListDetail>(listPath, { enabled: status === 'authenticated' });

  const items = list?.items ?? [];
  const returnedPage = list?.page;

  // Новая страница сборника — сбрасываем выбор слов
  useEffect(() => {
    setSelected(new Set());
  }, [list?.id, list?.page]);

  // Бэкенд может скорректировать номер страницы — синхронизируем состояние
  useEffect(() => {
    if (returnedPage && returnedPage !== page) setPage(returnedPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnedPage]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const totalPages = list ? Math.max(1, Math.ceil(list.totalItems / (list.pageSize || PAGE_SIZE))) : 1;
  const selectable = items.filter(i => !i.inDictionary);
  const allSelected = selectable.length > 0 && selectable.every(i => selected.has(i.wordText));

  const availableLevels = (() => {
    if (list?.cefrFrom && list?.cefrTo) {
      const from = LEVEL_ORDER.indexOf(list.cefrFrom.toUpperCase());
      const to = LEVEL_ORDER.indexOf(list.cefrTo.toUpperCase());
      if (from !== -1 && to !== -1 && from <= to) return LEVEL_ORDER.slice(from, to + 1);
    }
    return LEVEL_ORDER.slice(0, 4);
  })();

  const goToPage = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages) return;
    setSelected(new Set());
    setPage(nextPage);
  };

  const retryLoad = () => {
    setLearnError('');
    refreshList();
  };

  const togglePracticeLevel = (level: string) => {
    setPracticeLevels(prev => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const startPractice = () => {
    const levels = Array.from(practiceLevels).join(',');
    const query = new URLSearchParams();
    if (levels) query.set('levels', levels.toLowerCase());
    query.set('count', String(practiceCount));
    router.push(`/dictionary/lists/${listId}/practice?${query.toString()}`);
  };

  const toggleWord = (item: ListItem) => {
    if (item.inDictionary) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(item.wordText)) next.delete(item.wordText);
      else next.add(item.wordText);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable.map(i => i.wordText)));
    }
  };

  const learnWords = async (words: string[]) => {
    if (words.length === 0 || isLearning) return;
    if (words.length > 200 && !window.confirm(`Вы уверены, что хотите выучить ${words.length} ${pluralWords(words.length)} за раз? Лучше небольшими порциями.`)) {
      return;
    }
    setIsLearning(true);
    setLearnError('');
    try {
      const data = await apiMutate<{ added: number; skipped: number }>(`/api/wordlists/${listId}/learn`, {
        token: session?.accessToken,
        method: 'POST',
        body: { words },
        invalidate: ['/api/wordlists', '/api/dictionary']
      });
      if (!data) throw new Error('Failed to learn words');
      setNotice({ added: data.added, skipped: data.skipped });
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 4000);
      setSelected(new Set());
      // Статусы «в словаре» изменились — обновляем страницу из сети
      refreshList();
    } catch {
      setLearnError('Не удалось добавить слова. Попробуйте ещё раз.');
    } finally {
      setIsLearning(false);
    }
  };

  const learnSelected = () => learnWords(Array.from(selected));
  const learnAll = () => learnWords(selectable.map(i => i.wordText));

  if (status === 'loading' || (listLoading && !list)) {
    return (
      <AppLayout>
        <div role="status" aria-busy="true" className="animate-page-in">
          <span className="sr-only">Загрузка сборника</span>
          <Skeleton className="mb-4 h-4 w-40" />
          <Skeleton className="mb-2 h-8 w-64" />
          <Skeleton className="mb-6 h-4 w-96" />
          <Skeleton className="mb-6 h-24 w-full rounded-lg" />
          <div className="card space-y-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-4 w-4 shrink-0" />
                <Skeleton className={`h-4 ${i % 2 === 0 ? 'w-32' : 'w-24'}`} />
                <Skeleton className="ml-auto h-5 w-10 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!list) {
    return (
      <AppLayout>
        <BackToDictionary />
        <ErrorState
          title="Сборник не загрузился"
          description="Список слов не пришёл с сервера. Проверьте соединение и попробуйте снова."
          onRetry={retryLoad}
        />
      </AppLayout>
    );
  }

  const error = learnError || (listError ? 'Не удалось загрузить сборник. Проверьте соединение и попробуйте снова.' : '');

  return (
    <AppLayout>
      <BackToDictionary />

      {/* Живая область смонтирована заранее: появляющийся вместе с текстом
          region экранные читатели обычно не объявляют. */}
      <div role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {notice && (
            <motion.div
              variants={variants.enter}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="mb-4 flex items-center gap-2 rounded-lg bg-surface-success px-4 py-3 text-body-sm text-on-success"
            >
              <CheckIcon size={20} />
              <span>
                Добавлено {formatNumber(notice.added)} {pluralWords(notice.added)}
                {notice.skipped > 0 ? `, пропущено ${formatNumber(notice.skipped)}` : ''}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-semantic-error bg-surface-danger px-4 py-3 text-body-sm text-on-danger"
        >
          <span>{error}</span>
          <Button variant="secondary" onClick={retryLoad}>
            Попробовать снова
          </Button>
        </div>
      )}

      <PageHeader
        title={list.name}
        subtitle={list.description}
        actions={
          list.cefrFrom && list.cefrTo ? (
            <LevelChip level={list.cefrFrom} className="border border-hairline-strong px-3 py-1">
              {list.cefrFrom}–{list.cefrTo}
            </LevelChip>
          ) : null
        }
      />
      {/* Практика */}
      <div className="card mb-6 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:gap-6">
          <div className="min-w-64 flex-1">
            <h2 className="mb-2 text-body-sm font-semibold text-ink">Практика</h2>
            <div role="group" aria-label="Уровни для повторения" className="mb-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setPracticeLevels(new Set())}
                aria-pressed={practiceLevels.size === 0}
                className={practiceLevels.size === 0 ? 'icon-chip-active' : 'icon-chip'}
              >
                Все уровни
              </button>
              {availableLevels.map(level => {
                const active = practiceLevels.has(level);
                return (
                  <button
                    key={level}
                    onClick={() => togglePracticeLevel(level)}
                    aria-pressed={active}
                    className={active ? 'icon-chip-active' : 'icon-chip'}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
            <div role="group" aria-label="Количество слов" className="inline-flex overflow-hidden rounded-lg border border-hairline-strong">
              {[10, 20, 50].map(n => (
                <button
                  key={n}
                  onClick={() => setPracticeCount(n)}
                  aria-pressed={practiceCount === n}
                  className={`px-4 py-2 text-body-sm font-medium transition-[background-color,color] duration-fast ease-soft ${
                    practiceCount === n
                      ? 'bg-surface-highlight text-ink'
                      : 'bg-canvas text-slate hover:bg-surface hover:text-ink'
                  }`}
                >
                  {n} {pluralWords(n)}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:ml-auto">
            <p className="mb-2 max-w-measure-sm text-caption text-slate">
              Повторите слова, а незнакомые автоматически попадут в ваш словарь.
            </p>
            <Button onClick={startPractice} variant="primary">
              Начать повторение
            </Button>
          </div>
        </div>
      </div>

      {/* Панель действий */}
      <div className="card mb-6 flex flex-wrap items-center gap-3 p-4">
        <span className="text-body-sm text-slate">
          Выбрано <span className="font-semibold tabular-nums text-ink">{selected.size}</span>{' '}
          {pluralWords(selected.size)}
          <span className="text-slate">
            {' · '}{items.filter(i => i.inDictionary).length} на этой странице уже в словаре
          </span>
        </span>
        <div className="ml-auto flex w-full gap-2 sm:w-auto">
          <Button
            onClick={learnSelected}
            disabled={selected.size === 0 || isLearning}
            variant="primary"
            className="flex-1 sm:flex-none"
          >
            {isLearning ? <SpinnerIcon size={16} /> : null}
            Выучить выбранные
          </Button>
          <Button
            onClick={learnAll}
            disabled={selectable.length === 0 || isLearning}
            variant="secondary"
            className="flex-1 sm:flex-none"
          >
            Выучить все
          </Button>
        </div>
      </div>

      {/* Таблица слов */}
      <div className="card mb-4 overflow-hidden p-0">
        <div className="hidden grid-cols-[2.5rem_1fr_6rem_8rem] gap-3 border-b border-hairline-strong bg-surface px-4 py-3 text-caption font-semibold uppercase tracking-wide text-slate sm:grid">
          <div>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={selectable.length === 0}
              className="h-4 w-4 accent-primary"
              aria-label="Выбрать все слова на странице"
            />
          </div>
          <div>Слово</div>
          <div>Уровень</div>
          <div className="text-right">Статус</div>
        </div>
        {items.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<BookOpenIcon size={24} />}
            title="В сборнике пока пусто"
            description="Слова этого сборника ещё не загружены — начните с другой страницы или сборника."
          />
        ) : (
          <div className="stagger">
            {items.map((item, idx) => {
              const isSelected = selected.has(item.wordText);
              return (
                <div
                  key={`${item.wordText}-${idx}`}
                  onClick={() => toggleWord(item)}
                  className={`grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b border-hairline px-4 py-3 transition-colors duration-fast last:border-0 sm:grid-cols-[2.5rem_1fr_6rem_8rem] ${
                    item.inDictionary
                      ? 'cursor-default bg-surface-soft text-slate'
                      : isSelected
                        ? 'cursor-pointer bg-surface-highlight'
                        : 'cursor-pointer hover:bg-surface'
                  }`}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={item.inDictionary}
                      onChange={() => toggleWord(item)}
                      className="h-4 w-4 accent-primary"
                      aria-label={`Выбрать ${item.wordText}`}
                    />
                  </div>
                  <div className="flex min-w-0 items-center gap-2 font-medium text-ink">
                    <span className="truncate">{item.wordText}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        speak(item.wordText);
                      }}
                      className="icon-chip -my-1 h-8 min-w-8 border-transparent bg-transparent px-1.5 hover:bg-surface"
                      title="Произнести"
                      aria-label={`Произнести ${item.wordText}`}
                    >
                      <VolumeIcon size={16} />
                    </button>
                  </div>
                  <div><LevelChip level={item.cefrLevel} /></div>
                  <div className="text-right">
                    {item.inDictionary && <Tag tone="success">В словаре</Tag>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Pager
        page={page}
        totalPages={totalPages}
        onPageChange={(next) => {
          goToPage(next);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </AppLayout>
  );
}
