'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { API_URL } from '@/app/lib/api-url';
import { apiGet } from '@/app/lib/api-client';
import { useTrack } from '@/app/lib/analytics';
import Button from '@/components/ui/Button';
import { CheckIcon, RocketIcon, TrophyIcon } from '@/components/ui/icons';

const TARGET_WORDS = 5;
const DONE_KEY = 'first_lesson_done';

interface StepState {
  bookAdded: boolean;
  wordsCount: number;
}

function StepMark({ done }: { done: boolean }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-fast ease-soft ${
        done
          ? 'bg-primary text-on-primary'
          : 'border border-hairline-strong bg-canvas text-transparent'
      }`}
      aria-hidden="true"
    >
      <CheckIcon size={16} />
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

  // Загрузка статуса: книги + размер словаря (через кэш, чтобы не дёргать API зря)
  const refreshStatus = useCallback(async () => {
    const token = session?.accessToken;
    if (!token) return;
    try {
      const [books, words] = await Promise.all([
        apiGet<unknown[]>('/api/books', { token, maxAgeMs: 15_000 }),
        apiGet<unknown[]>('/api/dictionary', { token, maxAgeMs: 15_000 }),
      ]);
      setState({ bookAdded: books.length > 0, wordsCount: words.length });
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

  const stepTitle = (done: boolean) =>
    `text-body-sm font-medium ${done ? 'text-slate line-through' : 'text-ink'}`;

  return (
    <section className="card mb-8" aria-label="Первый урок">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-h2 text-ink">Твой первый урок — 15 минут</h2>
          <p className="mt-1 text-body-sm text-slate">
            Добавь рассказ, собери слова и пройди мини-тест
          </p>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-surface-accent text-primary">
          <RocketIcon size={20} />
        </span>
      </div>

      {complete ? (
        <div className="rounded-md bg-surface-accent p-5 text-center">
          <p className="inline-flex items-center gap-2 text-h3 text-on-accent">
            <TrophyIcon size={20} />
            Первый урок пройден
          </p>
          <p className="mt-1 text-body-sm text-on-accent">Так держать — впереди ещё книги.</p>
        </div>
      ) : (
        <ol className="space-y-4">
          <li className="flex items-center gap-3">
            <StepMark done={state.bookAdded} />
            <div className="min-w-0 flex-1">
              <p className={stepTitle(state.bookAdded)}>Добавь первый рассказ</p>
              {!state.bookAdded && (
                <p className="mt-0.5 text-caption text-slate">
                  «The Lost Kitten» — короткая история уровня A1
                </p>
              )}
            </div>
            {!state.bookAdded && (
              <Button onClick={addFirstStory} disabled={isAdding} className="shrink-0">
                {isAdding ? 'Добавляем…' : 'Добавить'}
              </Button>
            )}
          </li>

          <li className="flex items-center gap-3">
            <StepMark done={state.bookAdded} />
            <div className="min-w-0 flex-1">
              <p className={stepTitle(state.bookAdded)}>Прочитай первую страницу</p>
              {state.bookAdded && (
                <p className="mt-0.5 text-caption text-slate">Кликай по словам — увидишь перевод</p>
              )}
            </div>
            {state.bookAdded && (
              <Button variant="secondary" onClick={() => router.push('/books')} className="shrink-0">
                Открыть читалку
              </Button>
            )}
          </li>

          <li className="flex items-center gap-3">
            <StepMark done={state.wordsCount >= TARGET_WORDS} />
            <div className="min-w-0 flex-1">
              <p className={stepTitle(state.wordsCount >= TARGET_WORDS)}>
                Собери {TARGET_WORDS} слов в конспект
              </p>
              <p className="mt-0.5 text-caption text-slate">
                В читалке кликай по словам-маркерам — они попадут в конспект
              </p>
              {state.bookAdded && state.wordsCount < TARGET_WORDS && (
                <p className="mt-1 text-caption font-medium text-primary tabular-nums">
                  Слов собрано: {state.wordsCount} из {TARGET_WORDS}
                </p>
              )}
            </div>
          </li>

          <li className="flex items-center gap-3">
            <StepMark done={state.wordsCount >= TARGET_WORDS} />
            <div className="min-w-0 flex-1">
              <p className={stepTitle(state.wordsCount >= TARGET_WORDS)}>Пройди мини-тест</p>
              <p className="mt-0.5 text-caption text-slate">
                Появится после нажатия «Завершить чтение» в читалке
              </p>
            </div>
          </li>
        </ol>
      )}

      {state.bookAdded && state.wordsCount < TARGET_WORDS && !complete && (
        <p className="mt-5 rounded-md bg-surface-success p-4 text-center text-body-sm text-on-success">
          Отлично! Продолжай в читалке: кликай по словам-маркерам — собрано {state.wordsCount} из{' '}
          {TARGET_WORDS}
        </p>
      )}

      {addError && (
        <p role="alert" className="mt-4 text-body-sm text-semantic-error">
          {addError}
        </p>
      )}
    </section>
  );
}
