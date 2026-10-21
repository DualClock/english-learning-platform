'use client';

import AppLayout from '@/components/AppLayout';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { variants } from '@/lib/motion';
import { ApiError, apiMutate } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/LoadingState';
import { Tag } from '@/components/ui/Badge';
import CategoryIcon from '@/components/dictionary/CategoryIcon';
import { pluralWords } from '@/lib/plural';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CheckIcon,
  CloseIcon,
  SparkIcon,
  SpinnerIcon,
} from '@/components/ui/icons';

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
  learned: 'Выучено',
};

const statusTone: Record<CategoryWord['status'], 'neutral' | 'warning' | 'success'> = {
  not_started: 'neutral',
  learning: 'warning',
  learned: 'success',
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
    refresh: retryLoad,
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

  const words = category?.words ?? [];
  const learnedCount = words.filter((w) => w.status === 'learned').length;

  return (
    <AppLayout>
      {/*
        Узьше, чем каталог: здесь не список для просмотра, а одно задание.
        Карточка занятия сужается ещё сильнее (SessionShell), как в квизе.
      */}
      <div className="mx-auto max-w-3xl">
        <Button href="/categories" variant="ghost" className="mb-4">
          <ArrowLeftIcon size={16} />
          Все категории
        </Button>

        {error && (
          <ErrorState
            title="Категория не загрузилась"
            description={error}
            onRetry={retryLoad}
          />
        )}

        {!error && !category && isLoading && <CategorySkeleton />}

        {category && (
          <>
            <div className="page-header flex flex-wrap items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface text-primary">
                <CategoryIcon slug={category.slug} name={category.name} size={24} />
              </span>
              <div className="min-w-0">
                <h1 className="text-h1 text-ink">{category.name}</h1>
                <p className="mt-1 text-body-sm tabular-nums text-slate">
                  {words.length} {pluralWords(words.length)} · {learnedCount} выучено
                </p>
              </div>
            </div>

            <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Формат занятия">
              {modes.map((m) => (
                <button
                  key={m.key}
                  role="tab"
                  aria-selected={mode === m.key}
                  aria-controls="category-mode-panel"
                  onClick={() => setMode(m.key)}
                  className={mode === m.key ? 'pill-tab-active' : 'pill-tab'}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div id="category-mode-panel" role="tabpanel">
              {words.length === 0 ? (
                <EmptyState
                  icon={<BookOpenIcon size={24} />}
                  title="В категории пока нет слов"
                  description="Как только подборка наполнится, здесь появятся слова, карточки и упражнения."
                />
              ) : mode === 'list' ? (
                <motion.ul className="stagger space-y-3" initial={false}>
                  {words.map((word) => (
                    <li key={word.id} className="card flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                      {/*
                        basis-52: на узких экранах строка переносится целиком,
                        иначе метка и кнопка сжимают текст до одной буквы в строке.
                      */}
                      <div className="min-w-0 grow basis-52">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-body-lg font-semibold text-ink">{word.english}</span>
                          {word.transcription && (
                            <span className="text-body-sm text-slate">{word.transcription}</span>
                          )}
                        </div>
                        <div className="text-body text-ink">{word.translation}</div>
                        {word.example && (
                          <div className="mt-1 text-body-sm italic text-slate">{word.example}</div>
                        )}
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-3">
                        <Tag tone={statusTone[word.status]}>{statusLabel[word.status]}</Tag>
                        {word.inDictionary ? (
                          <span className="flex items-center gap-1.5 whitespace-nowrap text-body-sm font-medium text-primary">
                            <CheckIcon size={16} />
                            В словаре
                          </span>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => addToDictionary(word)}
                            disabled={addingId === word.id}
                          >
                            {addingId === word.id ? <SpinnerIcon size={16} /> : null}
                            В мой словарь
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </motion.ul>
              ) : mode === 'flashcards' ? (
                <Flashcards words={words} onResult={sendProgress} />
              ) : mode === 'guess' ? (
                <GuessTranslation words={words} onResult={sendProgress} />
              ) : (
                <ChoiceQuiz words={words} onResult={sendProgress} />
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

// 2 правильных подряд → learned, иначе learning
function useStreak(onResult: (wordId: number, status: 'learning' | 'learned') => void) {
  // Счётчик в ref, а не в state: апдейт статуса не должен перерисовывать
  // прокинувшуюся вверх сессию, а side effect внутри setStreaks вызывал
  // onResult во время рендера родителя.
  const streaks = useRef<Record<number, number>>({});

  return useCallback((wordId: number, correct: boolean) => {
    const next = correct ? (streaks.current[wordId] || 0) + 1 : 0;
    streaks.current[wordId] = next;
    onResult(wordId, next >= 2 ? 'learned' : 'learning');
  }, [onResult]);
}

/**
 * Колода замораживается на время сессии. Копия в state, а не useMemo([words]):
 * каждое оптимистичное обновление статуса слов меняет ссылку на массив, и
 * колода перезаказывалась бы прямо под пользователем — показывался один слово,
 * а проверка шла по другому.
 */
function useDeck(words: CategoryWord[]) {
  const [deck] = useState(() => shuffle(words));
  return deck;
}

function SessionShell({ title, index, total, children }: {
  title: string;
  index: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div className="card mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-h3 text-ink">{title}</h2>
        <span className="text-body-sm tabular-nums text-slate">
          {Math.min(index + 1, total)} / {total}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Итог сессии: одно состояние на все три формата. */
function SessionDone({ onRestart, note }: { onRestart: () => void; note: string }) {
  return (
    <div className="py-8 text-center">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-surface-accent text-on-accent">
        <SparkIcon size={24} />
      </span>
      <p className="text-h3 text-ink">Сессия завершена</p>
      <p className="mt-1 text-body-sm text-slate">{note}</p>
      <Button onClick={onRestart} className="mt-6">
        Пройти ещё раз
      </Button>
    </div>
  );
}

/** Пара «слово ↔ перевод»: смена стороны — только прозрачность, высота карточки не прыгает. */
function WordFace({ english, translation, transcription, example, flipped }: {
  english: string;
  translation: string;
  transcription?: string;
  example?: string;
  flipped: boolean;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={flipped ? 'back' : 'front'}
        variants={variants.fadeOnly}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className="text-h1 text-ink">{flipped ? translation : english}</div>
        {flipped ? (
          example && <div className="mt-3 italic text-body-lg text-slate">«{example}»</div>
        ) : (
          transcription && <div className="mt-2 text-body-lg text-slate">{transcription}</div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function Flashcards({ words, onResult }: {
  words: CategoryWord[];
  onResult: (wordId: number, status: 'learning' | 'learned') => void;
}) {
  const deck = useDeck(words);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const report = useStreak(onResult);

  if (deck.length === 0) return null;
  const done = index >= deck.length;
  const word = deck[Math.min(index, deck.length - 1)];

  return (
    <SessionShell title="Флэшкарты" index={index} total={deck.length}>
      {done ? (
        <SessionDone note="Вы прошли все карточки." onRestart={() => { setIndex(0); setFlipped(false); }} />
      ) : (
        <>
          <button
            onClick={() => setFlipped(!flipped)}
            className="flip-face w-full rounded-lg border border-hairline bg-surface px-6 py-8 text-center transition-colors duration-fast ease-soft hover:bg-surface-sunken active:scale-97"
          >
            <WordFace
              english={word.english}
              translation={word.translation}
              transcription={word.transcription}
              example={word.example}
              flipped={flipped}
            />
            <span className="mt-4 block shrink-0 text-caption text-slate">
              {flipped ? 'Слово' : 'Нажмите, чтобы перевернуть'}
            </span>
          </button>
          <div className="mt-6 flex justify-center gap-3">
            <Button
              variant="secondary"
              onClick={() => { report(word.id, false); setFlipped(false); setIndex(index + 1); }}
            >
              Не знаю
            </Button>
            <Button onClick={() => { report(word.id, true); setFlipped(false); setIndex(index + 1); }}>
              Знаю
            </Button>
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
  const deck = useDeck(words);
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
        <SessionDone
          note="Все слова этой подборки проверены."
          onRestart={() => { setIndex(0); setAnswer(''); setFeedback(null); }}
        />
      ) : (
        <>
          <div className="py-6 text-center">
            <div className="text-h1 text-ink">{word.english}</div>
            {word.transcription && (
              <div className="mt-2 text-body-lg text-slate">{word.transcription}</div>
            )}
          </div>
          <form
            className="mx-auto flex max-w-md gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (feedback) next();
              else check();
            }}
          >
            <label className="sr-only" htmlFor="category-guess">
              Перевод слова {word.english}
            </label>
            <input
              id="category-guess"
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Введите перевод..."
              className="input flex-1"
              autoFocus
            />
            <Button type="submit">{feedback ? 'Далее' : 'Проверить'}</Button>
          </form>
          {/* Только прозрачность: блок обратной связи не должен двигать страницу */}
          <div role="status" aria-live="polite">
            <AnimatePresence initial={false}>
              {feedback && (
                <motion.p
                  key={feedback}
                  variants={variants.fadeOnly}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className={`mt-4 flex items-center justify-center gap-2 text-center text-body font-semibold ${
                    feedback === 'correct' ? 'text-semantic-success' : 'text-semantic-error'
                  }`}
                >
                  {feedback === 'correct' ? <CheckIcon size={20} /> : <CloseIcon size={20} />}
                  {feedback === 'correct' ? 'Верно!' : `Неверно. Правильный ответ: ${word.translation}`}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </SessionShell>
  );
}

function ChoiceQuiz({ words, onResult }: {
  words: CategoryWord[];
  onResult: (wordId: number, status: 'learning' | 'learned') => void;
}) {
  const deck = useDeck(words);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const report = useStreak(onResult);

  useEffect(() => {
    if (index >= deck.length) return;
    const word = deck[index];
    const distractors = shuffle(deck.filter((w) => w.id !== word.id))
      .slice(0, 3)
      .map((w) => w.translation);
    setOptions(shuffle([word.translation, ...distractors]));
    setSelected(null);
  }, [index, deck]);

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
        <SessionDone
          note="Все варианты этого раунда разобраны."
          onRestart={() => setIndex(0)}
        />
      ) : (
        <>
          <div className="py-6 text-center">
            <div className="text-h1 text-ink">{word.english}</div>
            {word.transcription && (
              <div className="mt-2 text-body-lg text-slate">{word.transcription}</div>
            )}
          </div>
          <div className="mx-auto grid max-w-md gap-3">
            {options.map((option) => {
              const chosen = selected === option;
              const expected = option === word.translation;
              // Тот же тональный ряд, что и в грамматике: выбрано / верно /
              // ошиблось / правильный ответ подсвечен после проверки
              const tone = selected
                ? expected
                  ? 'border-semantic-success bg-surface-success text-ink'
                  : chosen
                    ? 'border-semantic-error bg-surface-danger text-ink'
                    : 'border-hairline text-slate'
                : 'border-hairline-strong text-ink hover:bg-surface';
              return (
                <button
                  key={option}
                  onClick={() => choose(option)}
                  disabled={selected !== null}
                  className={`flex items-center justify-between gap-3 rounded-md border px-5 py-2.5 text-left text-body-sm font-medium transition-[background-color,color,border-color,transform] duration-fast ease-soft active:scale-97 disabled:active:scale-100 ${tone}`}
                >
                  {option}
                  {selected && expected && <CheckIcon size={16} />}
                  {selected && chosen && !expected && <CloseIcon size={16} />}
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex justify-center">
            {/* Кнопка появляется под ответом и только по прозрачности: варианты не двигаются */}
            {selected && (
              <motion.div variants={variants.fadeOnly} initial="hidden" animate="visible">
                <Button onClick={() => setIndex(index + 1)}>Далее</Button>
              </motion.div>
            )}
          </div>
        </>
      )}
    </SessionShell>
  );
}

function CategorySkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="card mx-auto max-w-3xl">
      <span className="sr-only">Загрузка категории</span>
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <div className="mt-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
