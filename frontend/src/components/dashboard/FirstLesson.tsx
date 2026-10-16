'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { API_URL } from '@/app/lib/api-url';
import { useTrack } from '@/app/lib/analytics';

const TARGET_WORDS = 5;
const DONE_KEY = 'first_lesson_done';

interface StepState {
  bookAdded: boolean;
  wordsCount: number;
}

function Check({ done }: { done: boolean }) {
  return (
    <span
      className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
        done ? 'bg-[var(--color-primary)] text-white' : 'bg-white border-2 border-[var(--color-hairline-strong)] text-transparent'
      }`}
      aria-hidden="true"
    >
      ✓
    </span>
  );
}

export default function FirstLesson() {
  const { data: session } = useSession();
  const router = useRouter();
  const trackEvent = useTrack();

  const [state, setState] = useState<StepState>({ bookAdded: false, wordsCount: 0 });
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');

  // Аналитика: первый урок начат (один раз за визит)
  const trackedRef = useRef(false);
  useEffect(() => {
    if (!trackedRef.current && state.bookAdded) {
      trackedRef.current = true;
      trackEvent('lesson_completed', 'first_lesson_step');
    }
  }, [state.bookAdded, trackEvent]);
  const [doneShown, setDoneShown] = useState(false);

  // Загрузка статуса: книги + размер словаря
  const refreshStatus = useCallback(async () => {
    const token = session?.accessToken;
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [booksRes, dictRes] = await Promise.all([
        fetch(`${API_URL}/api/books`, { headers }),
        fetch(`${API_URL}/api/dictionary`, { headers }),
      ]);
      const bookAdded = booksRes.ok ? ((await booksRes.json()) as unknown[]).length > 0 : false;
      const wordsCount = dictRes.ok ? ((await dictRes.json()) as unknown[]).length : 0;
      setState({ bookAdded, wordsCount });
    } catch {
      // тихо: чек-лист не критичен
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    try {
      if (window.localStorage.getItem(DONE_KEY)) setDoneShown(true);
    } catch {
      // localStorage недоступен — просто показываем карточку по состоянию данных
    }
    refreshStatus();
  }, [session, refreshStatus]);

  // Обновление по фокусу окна и по таймеру — чтобы чеки догоняли после читалки
  useEffect(() => {
    const onFocus = () => refreshStatus();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(refreshStatus, 15000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [refreshStatus]);

  const complete = state.bookAdded && state.wordsCount >= TARGET_WORDS;

  // Первое достижение — фиксируем один раз
  useEffect(() => {
    if (!complete || doneShown) return;
    setDoneShown(true);
    try {
      window.localStorage.setItem(DONE_KEY, '1');
    } catch {
      // ignore
    }
  }, [complete, doneShown]);

  const addFirstStory = async () => {
    setIsAdding(true);
    setAddError('');
    try {
      const token = session?.accessToken;
      const res = await fetch(`${API_URL}/api/books/story/0`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      await refreshStatus();
    } catch {
      setAddError('Не удалось добавить рассказ. Попробуйте ещё раз.');
    } finally {
      setIsAdding(false);
    }
  };

  // Полностью готово и уже поздравляли — скрываем
  if (complete && doneShown) return null;

  return (
    <div className="card p-6 mb-6 border-[var(--color-tint-yellow-bold)] bg-gradient-to-br from-white to-[rgba(249,231,159,0.10)]">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-ink)]">Твой первый урок — 15 минут</h2>
          <p className="text-sm text-[var(--color-slate)] mt-1">
            Добавь рассказ, собери слова и пройди мини-тест
          </p>
        </div>
        <span className="text-3xl">🚀</span>
      </div>

      {complete ? (
        <div className="rounded-xl bg-[rgba(14,124,123,0.10)] border border-[rgba(14,124,123,0.30)] p-5 text-center">
          <p className="text-lg font-semibold text-[var(--color-primary)] mb-1">🎉 Поздравляем!</p>
          <p className="text-sm text-[var(--color-slate)]">Первый урок пройден — так держать!</p>
        </div>
      ) : (
        <>
          <ol className="space-y-4">
            {/* Шаг 1 — добавить рассказ */}
            <li className="flex items-center gap-3">
              <Check done={state.bookAdded} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${state.bookAdded ? 'text-[var(--color-slate)] line-through' : 'text-[var(--color-ink)]'}`}>
                  Добавь первый рассказ
                </p>
                {!state.bookAdded && (
                  <p className="text-xs text-[var(--color-slate)] mt-0.5">
                    «The Lost Kitten» — короткая история уровня A1
                  </p>
                )}
              </div>
              {!state.bookAdded && (
                <button
                  onClick={addFirstStory}
                  disabled={isAdding}
                  className="btn-primary text-sm py-2 px-4 shrink-0 disabled:opacity-50"
                >
                  {isAdding ? 'Добавляем…' : 'Добавить'}
                </button>
              )}
            </li>

            {/* Шаг 2 — открыть читалку */}
            <li className="flex items-center gap-3">
              <Check done={state.bookAdded} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${state.bookAdded ? 'text-[var(--color-slate)] line-through' : 'text-[var(--color-ink)]'}`}>
                  Прочитай первую страницу
                </p>
                {state.bookAdded && (
                  <p className="text-xs text-[var(--color-slate)] mt-0.5">
                    Кликай по словам — увидишь перевод
                  </p>
                )}
              </div>
              {state.bookAdded && (
                <button
                  onClick={() => router.push('/books')}
                  className="btn-secondary text-sm py-2 px-4 shrink-0"
                >
                  Открыть читалку
                </button>
              )}
            </li>

            {/* Шаг 3 — собрать слова */}
            <li className="flex items-center gap-3">
              <Check done={state.wordsCount >= TARGET_WORDS} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${state.wordsCount >= TARGET_WORDS ? 'text-[var(--color-slate)] line-through' : 'text-[var(--color-ink)]'}`}>
                  Собери {TARGET_WORDS} слов в конспект
                </p>
                <p className="text-xs text-[var(--color-slate)] mt-0.5">
                  В читалке кликай по словам с ✦ — они попадут в конспект
                </p>
                {state.bookAdded && state.wordsCount < TARGET_WORDS && (
                  <p className="text-xs font-semibold text-[var(--color-primary)] mt-1">
                    Слов собрано: {state.wordsCount} из {TARGET_WORDS}
                  </p>
                )}
              </div>
            </li>

            {/* Шаг 4 — мини-тест */}
            <li className="flex items-center gap-3">
              <Check done={state.wordsCount >= TARGET_WORDS} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${state.wordsCount >= TARGET_WORDS ? 'text-[var(--color-slate)] line-through' : 'text-[var(--color-ink)]'}`}>
                  Пройди мини-тест
                </p>
                <p className="text-xs text-[var(--color-slate)] mt-0.5">
                  Появится после нажатия «Завершить чтение» в читалке
                </p>
              </div>
            </li>
          </ol>

          {state.bookAdded && state.wordsCount < TARGET_WORDS && (
            <div className="mt-5 rounded-xl bg-[var(--color-tint-mint)] p-4 text-center">
              <p className="text-sm text-[var(--color-ink)]">
                Отлично! Продолжай в читалке: кликай по словам с ✦
              </p>
              <p className="text-sm font-semibold text-[var(--color-primary)] mt-1">
                Слов собрано: {state.wordsCount} из {TARGET_WORDS}
              </p>
            </div>
          )}

          {addError && (
            <p className="mt-4 text-sm text-[var(--color-error)]">{addError}</p>
          )}
        </>
      )}
    </div>
  );
}
