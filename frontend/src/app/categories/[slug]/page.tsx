'use client';

import AppLayout from '@/components/AppLayout';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useSession } from 'next-auth/react';
import { AnimatePresence, motion } from 'motion/react';
import { variants, transition } from '@/lib/motion';
import { ApiError, apiMutate } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/LoadingState';
import { Tag } from '@/components/ui/Badge';
import CategoryIcon from '@/components/dictionary/CategoryIcon';
import WordIllustration from '@/components/dictionary/WordIllustration';
import WordFlashcard from '@/components/dictionary/WordFlashcard';
import { pluralWords } from '@/lib/plural';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
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
  exampleRu?: string;
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

/**
 * Вход новой карточки с той стороны, куда листаем: вправо — новая приходит
 * справа, старая уходит влево. Направление задаёт `custom`, чтобы exit и enter
 * не разъехались при быстром нажатии.
 */
const flashcardSlide = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 40 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -40 }),
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
  const { status: authStatus } = useSession();

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
        method: 'POST',
        body: { status: statusValue },
        invalidate: ['/api/categories'],
      });
    } catch {
      // прогресс обновится при следующей загрузке
    }
  }, []);

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
                        Иллюстрация — сосед текста, а не часть его колонки: у слов
                        без картинки компонент возвращает null, лишнего отступа и
                        пустого места не остаётся, высота строки не меняется.
                      */}
                      <WordIllustration
                        categorySlug={category.slug}
                        word={word.english}
                        translation={word.translation}
                        size="sm"
                      />
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
                <Flashcards words={words} categorySlug={category.slug} onResult={sendProgress} />
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

function Flashcards({ words, categorySlug, onResult }: {
  words: CategoryWord[];
  categorySlug: string;
  onResult: (wordId: number, status: 'learning' | 'learned') => void;
}) {
  const deck = useDeck(words);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [direction, setDirection] = useState(1);
  const report = useStreak(onResult);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const suppressFlip = useRef(false);

  const go = useCallback((delta: number) => {
    setFlipped(false);
    setDirection(delta);
    setIndex((current) => Math.max(0, Math.min(deck.length - 1, current + delta)));
  }, [deck.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Событие может прийти не от элемента (window/document): такие клавиши
      // всё равно листают, а проверять поля ввода имеет смысл только у DOM-узла.
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go]);

  if (deck.length === 0) return null;

  if (index >= deck.length) {
    return (
      <section className="flashcard-stage" aria-label="Флэшкарты">
        <SessionDone
          note="Вы прошли все карточки."
          onRestart={() => {
            setIndex(0);
            setFlipped(false);
            setDirection(1);
          }}
        />
      </section>
    );
  }

  const word = deck[index];

  const flip = () => {
    if (suppressFlip.current) return;
    setFlipped((value) => !value);
  };

  const mark = (correct: boolean) => {
    report(word.id, correct);
    setFlipped(false);
    setDirection(1);
    setIndex((current) => current + 1);
  };

  // Свайп только горизонтальный: вертикальный жест оставляем странице,
  // а короткий тап не должен превращаться в листание.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-no-swipe]')) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    // Клик после свайпа не должен переворачивать уже следующую карточку.
    suppressFlip.current = true;
    window.setTimeout(() => { suppressFlip.current = false; }, 0);
    go(dx < 0 ? 1 : -1);
  };

  return (
    <section className="flashcard-stage" aria-label="Флэшкарты">
      <div
        className="flashcard-swipe"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragStart.current = null; }}
      >
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={word.id}
            custom={direction}
            variants={flashcardSlide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition.fast}
          >
            <WordFlashcard
              word={word}
              categorySlug={categorySlug}
              flipped={flipped}
              onFlip={flip}
              hintId="flashcard-hint"
            />
          </motion.div>
        </AnimatePresence>
      </div>

      <p id="flashcard-hint" className="flashcard-hint">
        {flipped
          ? 'Нажмите, чтобы вернуть слово'
          : 'Нажмите на карточку, чтобы увидеть перевод'}
      </p>

      <div className="flashcard-nav">
        <button
          type="button"
          className="flashcard-arrow"
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label="Предыдущая карточка"
        >
          <ChevronRightIcon size={24} className="rotate-180" />
        </button>
        <span className="flashcard-progress" aria-live="polite">
          {String(index + 1).padStart(2, '0')} / {String(deck.length).padStart(2, '0')}
        </span>
        <button
          type="button"
          className="flashcard-arrow flashcard-arrow-next"
          onClick={() => go(1)}
          disabled={index >= deck.length - 1}
          aria-label="Следующая карточка"
        >
          <ChevronRightIcon size={24} />
        </button>
      </div>

      <div className="flashcard-actions">
        <button type="button" className="flashcard-action" onClick={() => mark(false)}>
          Не знаю
        </button>
        <button
          type="button"
          className="flashcard-action flashcard-action-primary"
          onClick={() => mark(true)}
        >
          Знаю
        </button>
      </div>
    </section>
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
