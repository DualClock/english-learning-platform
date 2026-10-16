'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';
import { useSpeech } from '@/hooks/useSpeech';

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

const cefrStyles: Record<string, string> = {
  A1: 'bg-[rgba(93,100,112,0.10)] text-[var(--color-slate)]',
  A2: 'bg-[rgba(14,124,123,0.10)] text-[var(--color-primary)]',
  B1: 'bg-[rgba(249,231,159,0.15)] text-[#8A6D1D]',
  B2: 'bg-[rgba(249,231,159,0.25)] text-[#7A5C10]',
  C1: 'bg-[rgba(14,124,123,0.20)] text-[var(--color-primary)]',
  C2: 'bg-[rgba(14,124,123,0.20)] text-[var(--color-primary)]'
};

function LevelChip({ level }: { level: string }) {
  const cls = cefrStyles[level] || cefrStyles.A1;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {level}
    </span>
  );
}

export default function WordListPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { speak } = useSpeech();
  const params = useParams();
  const listId = params?.id as string;

  const [list, setList] = useState<ListDetail | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLearning, setIsLearning] = useState(false);
  const [notice, setNotice] = useState<{ added: number; skipped: number } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [practiceLevels, setPracticeLevels] = useState<Set<string>>(new Set());
  const [practiceCount, setPracticeCount] = useState(20);

  const loadList = useCallback(async (p: number) => {
    setIsLoading(true);
    setError('');
    try {
      const token = session?.accessToken;
      const res = await fetch(`${API_URL}/api/wordlists/${listId}?page=${p}&pageSize=${PAGE_SIZE}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to load list');
      const data: ListDetail = await res.json();
      setList(data);
      setSelected(new Set());
      setPage(data.page || p);
    } catch {
      setError('Не удалось загрузить сборник. Проверьте соединение и попробуйте снова.');
    } finally {
      setIsLoading(false);
    }
  }, [session, listId]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated' && listId) {
      loadList(1);
    }
  }, [status, router, listId, loadList]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const totalPages = list ? Math.max(1, Math.ceil(list.totalItems / list.pageSize)) : 1;
  const selectable = list?.items.filter(i => !i.inDictionary) ?? [];
  const allSelected = selectable.length > 0 && selectable.every(i => selected.has(i.wordText));

  const availableLevels = (() => {
    if (list?.cefrFrom && list?.cefrTo) {
      const from = LEVEL_ORDER.indexOf(list.cefrFrom.toUpperCase());
      const to = LEVEL_ORDER.indexOf(list.cefrTo.toUpperCase());
      if (from !== -1 && to !== -1 && from <= to) return LEVEL_ORDER.slice(from, to + 1);
    }
    return LEVEL_ORDER.slice(0, 4);
  })();

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
    if (words.length > 200 && !window.confirm(`Вы уверены, что хотите выучить ${words.length} слов за раз? Лучше небольшими порциями 🔥`)) {
      return;
    }
    setIsLearning(true);
    try {
      const token = session?.accessToken;
      const res = await fetch(`${API_URL}/api/wordlists/${listId}/learn`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ words })
      });
      if (!res.ok) throw new Error('Failed to learn words');
      const data: { added: number; skipped: number } = await res.json();
      setNotice({ added: data.added, skipped: data.skipped });
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 4000);
      await loadList(page);
    } catch {
      setError('Не удалось добавить слова. Попробуйте ещё раз.');
    } finally {
      setIsLearning(false);
    }
  };

  const learnSelected = () => learnWords(Array.from(selected));
  const learnAll = () => learnWords(selectable.map(i => i.wordText));

  if (status === 'loading' || isLoading || !list) {
    return (
      <AppLayout>
        <div className="mb-6 h-4 bg-[rgba(201,205,212,0.40)] rounded w-32 animate-pulse"></div>
        <div className="h-8 bg-[rgba(201,205,212,0.40)] rounded w-64 mb-2 animate-pulse"></div>
        <div className="h-4 bg-[rgba(201,205,212,0.40)] rounded w-96 mb-6 animate-pulse"></div>
        <div className="card p-4 mb-3 animate-pulse" >
          <div className="h-5 bg-[rgba(201,205,212,0.40)] rounded w-1/3"></div>
        </div>
        {[...Array(8)].map((_, i) => (
          <div key={i} className="card p-4 mb-3 animate-pulse">
            <div className="h-5 bg-[rgba(201,205,212,0.40)] rounded w-1/4"></div>
          </div>
        ))}
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <button
        onClick={() => router.push('/dictionary?tab=lists')}
        className="mb-4 text-sm text-[var(--color-slate)] hover:text-[var(--color-primary)] transition-colors"
      >
        ← Назад к словарю
      </button>

      {notice && (
        <div className="mb-4 p-4 rounded-xl bg-[rgba(14,124,123,0.10)] border border-[var(--color-primary)] text-[var(--color-primary)]">
          ✅ Добавлено {notice.added} слов{notice.skipped > 0 ? `, пропущено ${notice.skipped}` : ''}
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 rounded-xl bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)] flex items-center justify-between gap-4">
          <span>{error}</span>
          <button onClick={() => loadList(page)} className="btn-secondary shrink-0">
            Попробовать снова
          </button>
        </div>
      )}

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-[var(--color-ink)]">{list.name}</h1>
          {list.cefrFrom && list.cefrTo && (
            <span className="badge badge-primary">{list.cefrFrom}–{list.cefrTo}</span>
          )}
        </div>
        {list.description && <p className="text-[var(--color-slate)]">{list.description}</p>}
        <p className="text-sm text-[var(--color-slate)] mt-1">
          {list.items.filter(i => i.inDictionary).length} из {list.items.length.toLocaleString('ru-RU')} на этой странице уже в вашем словаре
        </p>
      </div>

      {/* Практика */}
      <div className="card p-4 sm:p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <h2 className="text-sm font-semibold text-[var(--color-ink)] mb-2">Практика</h2>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                onClick={() => setPracticeLevels(new Set())}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  practiceLevels.size === 0
                    ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white'
                    : 'bg-white border-[var(--color-hairline-strong)] text-[var(--color-slate)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                }`}
              >
                Все уровни
              </button>
              {availableLevels.map(level => {
                const active = practiceLevels.has(level);
                return (
                  <button
                    key={level}
                    onClick={() => togglePracticeLevel(level)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      active
                        ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white'
                        : 'bg-white border-[var(--color-hairline-strong)] text-[var(--color-slate)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                    }`}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
            <div className="inline-flex rounded-xl border border-[var(--color-hairline-strong)] overflow-hidden">
              {[10, 20, 50].map(n => (
                <button
                  key={n}
                  onClick={() => setPracticeCount(n)}
                  className={`px-4 py-1.5 text-xs font-semibold transition-colors ${
                    practiceCount === n
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-white text-[var(--color-slate)] hover:bg-[var(--color-surface)]'
                  }`}
                >
                  {n} слов
                </button>
              ))}
            </div>
          </div>
          <div className="sm:border-l sm:border-[var(--color-hairline-strong)] sm:pl-6">
            <p className="text-xs text-[var(--color-slate)] mb-2 max-w-[220px]">
              Повторите слова, а незнакомые автоматически попадут в ваш словарь.
            </p>
            <button onClick={startPractice} className="btn-primary">
              Начать повторение
            </button>
          </div>
        </div>
      </div>

      {/* Панель действий */}
      <div className="card p-4 mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm text-[var(--color-slate)]">
          Выбрано <span className="font-semibold text-[var(--color-ink)]">{selected.size}</span> слов
        </span>
        <div className="flex gap-2 ml-auto">
          <button
            onClick={learnSelected}
            disabled={selected.size === 0 || isLearning}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Выучить выбранные
          </button>
          <button
            onClick={learnAll}
            disabled={selectable.length === 0 || isLearning}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Выучить все
          </button>
        </div>
      </div>

      {/* Таблица слов */}
      <div className="card overflow-hidden mb-4">
        <div className="hidden sm:grid grid-cols-[2.5rem_1fr_6rem_8rem] gap-3 px-4 py-3 border-b border-[var(--color-hairline-strong)] bg-[var(--color-surface)] text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wide">
          <div>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={selectable.length === 0}
              className="accent-[var(--color-primary)]"
              aria-label="Выбрать все"
            />
          </div>
          <div>Слово</div>
          <div>Уровень</div>
          <div className="text-right">Статус</div>
        </div>
        {list.items.map((item, idx) => (
          <div
            key={`${item.wordText}-${idx}`}
            onClick={() => toggleWord(item)}
            className={`grid grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[2.5rem_1fr_6rem_8rem] gap-3 px-4 py-3 items-center border-b border-[rgba(201,205,212,0.60)] last:border-0 transition-colors ${
              item.inDictionary ? 'opacity-70 cursor-default' : 'cursor-pointer hover:bg-[var(--color-surface)]'
            }`}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected.has(item.wordText)}
                disabled={item.inDictionary}
                onChange={() => toggleWord(item)}
                className="accent-[var(--color-primary)]"
                aria-label={`Выбрать ${item.wordText}`}
              />
            </div>
            <div className="font-medium text-[var(--color-ink)] flex items-center gap-2 min-w-0">
              <span className="truncate">{item.wordText}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  speak(item.wordText);
                }}
                className="p-1 text-sm rounded-full hover:bg-[var(--color-tint-mint)] transition-colors shrink-0"
                title="Произнести"
                aria-label={`Произнести ${item.wordText}`}
              >
                🔊
              </button>
            </div>
            <div><LevelChip level={item.cefrLevel} /></div>
            <div className="text-right">
              {item.inDictionary && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[rgba(14,124,123,0.10)] text-[var(--color-primary)]">
                  ✅ В словаре
                </span>
              )}
            </div>
          </div>
        ))}
        {list.items.length === 0 && (
          <div className="p-8 text-center text-[var(--color-slate)]">В этом сборнике пока пусто</div>
        )}
      </div>

      {/* Пагинация */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => loadList(page - 1)}
            disabled={page <= 1 || isLoading}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Назад
          </button>
          <span className="text-sm text-[var(--color-slate)]">
            страница {page} из {totalPages}
          </span>
          <button
            onClick={() => loadList(page + 1)}
            disabled={page >= totalPages || isLoading}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Вперёд →
          </button>
        </div>
      )}
    </AppLayout>
  );
}
