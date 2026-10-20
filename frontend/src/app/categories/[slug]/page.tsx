'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ApiError, apiMutate } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';

interface CategoryWord {
  id: number;
  english: string;
  translation: string;
  transcription?: string;
  example?: string;
  status: 'not_started' | 'learning' | 'learned';
  inDictionary: boolean;
}

interface CategoryDetail {
  id: number;
  name: string;
  slug: string;
  icon?: string;
  color?: string;
  description?: string;
  words: CategoryWord[];
}

type Mode = 'list' | 'flashcards' | 'guess' | 'choice';

const statusLabel: Record<CategoryWord['status'], string> = {
  not_started: 'Не начато',
  learning: 'В процессе',
  learned: 'Выучено'
};

const statusColor: Record<CategoryWord['status'], string> = {
  not_started: 'bg-[rgba(201,205,212,0.40)] text-[var(--color-slate)]',
  learning: 'bg-amber-100 text-amber-700',
  learned: 'bg-green-100 text-green-700'
};

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function CategoryPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const token = session?.accessToken ?? null;

  const {
    data: categoryData,
    error: categoryError,
    isLoading,
  } = useApiQuery<CategoryDetail>(slug ? `/api/categories/${slug}/words` : null, {
    enabled: authStatus === 'authenticated',
  });

  const [category, setCategory] = useState<CategoryDetail | null>(categoryData ?? null);
  const [mode, setMode] = useState<Mode>('list');
  const [addingId, setAddingId] = useState<number | null>(null);

  // Ошибку показываем, только если данных ещё нет: если категория уже
  // отрисована из кэша, неудачное фоновое обновление её не перекрывает.
  const error = categoryError && categoryData === undefined ? 'Не удалось загрузить категорию.' : '';

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login');
  }, [authStatus, router]);

  // Кэш из useApiQuery — источник истины; локальная копия нужна для
  // оптимистичных обновлений статуса слов и «В мой словарь».
  useEffect(() => {
    if (categoryData) setCategory(categoryData);
  }, [categoryData]);

  const sendProgress = useCallback(async (wordId: number, statusValue: 'learning' | 'learned') => {
    setCategory((prev) => prev && ({
      ...prev,
      words: prev.words.map((w) => w.id === wordId ? { ...w, status: statusValue } : w)
    }));
    try {
      await apiMutate(`/api/categories/words/${wordId}/progress`, {
        token,
        method: 'POST',
        body: { status: statusValue },
        invalidate: ['/api/categories'],
      });
    } catch {
      // прогресс обновится при следующей загрузке
    }
  }, [token]);

  const markInDictionary = useCallback((wordId: number) => {
    setCategory((prev) => prev && ({
      ...prev,
      words: prev.words.map((w) => w.id === wordId ? { ...w, inDictionary: true } : w)
    }));
  }, []);

  const addToDictionary = async (word: CategoryWord) => {
    setAddingId(word.id);
    try {
      await apiMutate('/api/dictionary', {
        token,
        method: 'POST',
        body: {
          text: word.english,
          definition: word.translation,
          example: word.example,
          source: 'category'
        },
        invalidate: ['/api/dictionary', '/api/categories'],
      });
      markInDictionary(word.id);
    } catch (err) {
      // 409 — слово уже есть в словаре, это не ошибка
      if (err instanceof ApiError && err.status === 409) {
        markInDictionary(word.id);
      }
      // остальное игнорируем — пользователь может повторить
    } finally {
      setAddingId(null);
    }
  };

  const modes: { key: Mode; label: string }[] = [
    { key: 'list', label: 'Слова' },
    { key: 'flashcards', label: 'Флэшкарты' },
    { key: 'guess', label: 'Угадай перевод' },
    { key: 'choice', label: 'Выбери вариант' }
  ];

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto">
        <Link href="/categories" className="text-sm text-[var(--color-slate)] hover:text-[var(--color-ink)]">
          ← Все категории
        </Link>

        {error && <div className="card p-12 text-center mt-4 text-[var(--color-slate)]">{error}</div>}

        {!error && !category && isLoading && (
          <div className="card p-6 animate-pulse mt-4">
            <div className="h-7 bg-[rgba(201,205,212,0.40)] rounded w-1/3 mb-3"></div>
            <div className="h-4 bg-[rgba(201,205,212,0.40)] rounded w-2/3"></div>
          </div>
        )}

        {category && (
          <>
            <div className="flex items-center gap-4 mt-4 mb-6">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
                style={{ backgroundColor: `${category.color || '#3B82F6'}20` }}
              >
                <span aria-hidden="true">{category.icon || '📖'}</span>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-[var(--color-ink)]">{category.name}</h1>
                <p className="text-[var(--color-slate)]">{category.words.length} слов</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              {modes.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  className={mode === m.key ? 'btn-primary' : 'btn-secondary'}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {mode === 'list' && (
              <div className="space-y-3">
                {category.words.map((word) => (
                  <div key={word.id} className="card p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-semibold text-[var(--color-ink)]">{word.english}</span>
                        {word.transcription && (
                          <span className="text-sm text-[var(--color-slate)]">{word.transcription}</span>
                        )}
                      </div>
                      <div className="text-[var(--color-ink)]">{word.translation}</div>
                      {word.example && (
                        <div className="text-sm text-[var(--color-slate)] mt-1 italic">{word.example}</div>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${statusColor[word.status]}`}>
                      {statusLabel[word.status]}
                    </span>
                    {word.inDictionary ? (
                      <span className="text-xs text-green-600 whitespace-nowrap">✓ В словаре</span>
                    ) : (
                      <button
                        onClick={() => addToDictionary(word)}
                        disabled={addingId === word.id}
                        className="btn-secondary text-sm whitespace-nowrap"
                      >
                        {addingId === word.id ? '...' : 'В мой словарь'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {mode === 'flashcards' && (
              <Flashcards words={category.words} onResult={sendProgress} />
            )}
            {mode === 'guess' && (
              <GuessTranslation words={category.words} onResult={sendProgress} />
            )}
            {mode === 'choice' && (
              <ChoiceQuiz words={category.words} onResult={sendProgress} />
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

// 2 правильных подряд → learned, иначе learning
function useStreak(onResult: (wordId: number, status: 'learning' | 'learned') => void) {
  const [, setStreaks] = useState<Record<number, number>>({});

  const report = useCallback((wordId: number, correct: boolean) => {
    setStreaks((prev) => {
      const next = { ...prev, [wordId]: correct ? (prev[wordId] || 0) + 1 : 0 };
      onResult(wordId, next[wordId] >= 2 ? 'learned' : 'learning');
      return next;
    });
  }, [onResult]);

  return report;
}

function SessionShell({ title, index, total, children }: {
  title: string;
  index: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">{title}</h2>
        <span className="text-sm text-[var(--color-slate)]">{Math.min(index + 1, total)} / {total}</span>
      </div>
      {children}
    </div>
  );
}

function Flashcards({ words, onResult }: {
  words: CategoryWord[];
  onResult: (wordId: number, status: 'learning' | 'learned') => void;
}) {
  const deck = useMemo(() => shuffle(words), [words]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const report = useStreak(onResult);

  if (deck.length === 0) return null;
  const done = index >= deck.length;
  const word = deck[Math.min(index, deck.length - 1)];

  return (
    <SessionShell title="Флэшкарты" index={index} total={deck.length}>
      {done ? (
        <div className="text-center py-8">
          <p className="text-xl font-semibold text-[var(--color-ink)] mb-2">Готово! 🎉</p>
          <p className="text-[var(--color-slate)]">Вы прошли все карточки.</p>
          <button className="btn-primary mt-4" onClick={() => { setIndex(0); setFlipped(false); }}>
            Пройти ещё раз
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={() => setFlipped(!flipped)}
            className="w-full py-16 rounded-2xl border-2 border-dashed border-[var(--color-hairline-strong)] hover:border-[var(--color-primary)] transition-colors text-center"
          >
            {!flipped ? (
              <>
                <div className="text-3xl font-bold text-[var(--color-ink)]">{word.english}</div>
                {word.transcription && (
                  <div className="text-[var(--color-slate)] mt-2">{word.transcription}</div>
                )}
                <div className="text-sm text-[var(--color-slate)] mt-4">Нажмите, чтобы перевернуть</div>
              </>
            ) : (
              <>
                <div className="text-3xl font-bold text-[var(--color-ink)]">{word.translation}</div>
                {word.example && (
                  <div className="text-[var(--color-slate)] mt-3 italic">{word.example}</div>
                )}
              </>
            )}
          </button>
          <div className="flex gap-3 mt-6 justify-center">
            <button
              className="btn-secondary"
              onClick={() => { report(word.id, false); setFlipped(false); setIndex(index + 1); }}
            >
              Не знаю
            </button>
            <button
              className="btn-primary"
              onClick={() => { report(word.id, true); setFlipped(false); setIndex(index + 1); }}
            >
              Знаю
            </button>
          </div>
        </>
      )}
    </SessionShell>
  );
}

function GuessTranslation({ words, onResult }: {
  words: CategoryWord[];
  onResult: (wordId: number, status: 'learning' | 'learned') => void;
}) {
  const deck = useMemo(() => shuffle(words), [words]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const report = useStreak(onResult);

  if (deck.length === 0) return null;
  const done = index >= deck.length;
  const word = deck[Math.min(index, deck.length - 1)];

  const normalize = (s: string) => s.trim().toLowerCase();
  const acceptedAnswers = word.translation
    .split(/[,;]/)
    .map((s) => normalize(s))
    .filter(Boolean);

  const check = () => {
    if (!answer.trim() || feedback) return;
    const correct = acceptedAnswers.some((a) => a === normalize(answer));
    setFeedback(correct ? 'correct' : 'wrong');
    report(word.id, correct);
  };

  const next = () => {
    setAnswer('');
    setFeedback(null);
    setIndex(index + 1);
  };

  return (
    <SessionShell title="Угадай перевод" index={index} total={deck.length}>
      {done ? (
        <div className="text-center py-8">
          <p className="text-xl font-semibold text-[var(--color-ink)] mb-2">Сессия завершена! 🎉</p>
          <button className="btn-primary mt-2" onClick={() => { setIndex(0); setAnswer(''); setFeedback(null); }}>
            Пройти ещё раз
          </button>
        </div>
      ) : (
        <>
          <div className="text-center py-6">
            <div className="text-3xl font-bold text-[var(--color-ink)]">{word.english}</div>
            {word.transcription && (
              <div className="text-[var(--color-slate)] mt-2">{word.transcription}</div>
            )}
          </div>
          <div className="flex gap-3 max-w-md mx-auto">
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (feedback) next();
                else check();
              }}
              placeholder="Введите перевод..."
              className="input flex-1"
              autoFocus
            />
            {feedback ? (
              <button className="btn-primary" onClick={next}>Далее</button>
            ) : (
              <button className="btn-primary" onClick={check}>Проверить</button>
            )}
          </div>
          {feedback && (
            <div className={`text-center mt-4 font-medium ${feedback === 'correct' ? 'text-green-600' : 'text-red-600'}`}>
              {feedback === 'correct' ? 'Верно! ✓' : `Неверно. Правильный ответ: ${word.translation}`}
            </div>
          )}
        </>
      )}
    </SessionShell>
  );
}

function ChoiceQuiz({ words, onResult }: {
  words: CategoryWord[];
  onResult: (wordId: number, status: 'learning' | 'learned') => void;
}) {
  const deck = useMemo(() => shuffle(words), [words]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const report = useStreak(onResult);

  useEffect(() => {
    if (index >= deck.length) return;
    const word = deck[index];
    const distractors = shuffle(words.filter((w) => w.id !== word.id))
      .slice(0, 3)
      .map((w) => w.translation);
    setOptions(shuffle([word.translation, ...distractors]));
    setSelected(null);
  }, [index, deck, words]);

  if (deck.length === 0) return null;
  const done = index >= deck.length;
  const word = deck[Math.min(index, deck.length - 1)];

  const choose = (option: string) => {
    if (selected) return;
    setSelected(option);
    report(word.id, option === word.translation);
  };

  return (
    <SessionShell title="Выбери вариант" index={index} total={deck.length}>
      {done ? (
        <div className="text-center py-8">
          <p className="text-xl font-semibold text-[var(--color-ink)] mb-2">Сессия завершена! 🎉</p>
          <button className="btn-primary mt-2" onClick={() => setIndex(0)}>Пройти ещё раз</button>
        </div>
      ) : (
        <>
          <div className="text-center py-6">
            <div className="text-3xl font-bold text-[var(--color-ink)]">{word.english}</div>
            {word.transcription && (
              <div className="text-[var(--color-slate)] mt-2">{word.transcription}</div>
            )}
          </div>
          <div className="grid gap-3 max-w-md mx-auto">
            {options.map((option) => {
              let cls = 'btn-secondary w-full text-left';
              if (selected) {
                if (option === word.translation) cls += ' !border-green-500 !text-green-700';
                else if (option === selected) cls += ' !border-red-500 !text-red-700';
              }
              return (
                <button key={option} className={cls} onClick={() => choose(option)}>
                  {option}
                </button>
              );
            })}
          </div>
          {selected && (
            <div className="text-center mt-6">
              <button className="btn-primary" onClick={() => setIndex(index + 1)}>Далее</button>
            </div>
          )}
        </>
      )}
    </SessionShell>
  );
}
