'use client';

import AppLayout from '@/components/AppLayout';
import LexiPeek from '@/components/brand/lexi/LexiPeek';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useApiQuery } from '@/app/lib/use-api';
import { apiMutate, cacheKey, peekCache } from '@/app/lib/api-client';
import { useTrack } from '@/app/lib/analytics';
import { useSpeech } from '@/hooks/useSpeech';
import EmptyState from '@/components/ui/EmptyState';import ErrorState from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/LoadingState';
import Button from '@/components/ui/Button';
import ProgressBar from '@/components/ui/ProgressBar';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import LevelChip from '@/components/ui/LevelChip';
import {
  ArrowLeftIcon,
  CheckIcon,
  CloseIcon,
  InboxIcon,
  SpinnerIcon,
  VolumeIcon,
} from '@/components/ui/icons';
import { slideVariants, variants } from '@/lib/motion';
import { pluralWords } from '@/lib/plural';

interface ListItem {
  wordText: string;
  cefrLevel: string;
  freqRank: number;
  inDictionary: boolean;
}

interface WordListPage {
  items: ListItem[];
  totalItems: number;
  page?: number;
}

const FETCH_PAGE_SIZE = 200; // максимум, который принимает бэкенд

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Phase = 'loading' | 'empty' | 'card' | 'finished';
type TranslationState =
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'ok'; text: string }
  | { status: 'error' };

function PracticeContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const trackEvent = useTrack();
  const { speak } = useSpeech();
  const params = useParams();
  const searchParams = useSearchParams();
  const listId = params?.id as string;

  const levels = (searchParams.get('levels') || '')
    .split(',')
    .map(l => l.trim().toUpperCase())
    .filter(Boolean);
  const count = Math.min(50, Math.max(1, parseInt(searchParams.get('count') || '20', 10) || 20));
  const levelsKey = levels.join(',');

  const [phase, setPhase] = useState<Phase>('loading');
  const [batch, setBatch] = useState<ListItem[]>([]);
  const [index, setIndex] = useState(0);
  const [translation, setTranslation] = useState<TranslationState>({ status: 'hidden' });
  const [unknown, setUnknown] = useState<string[]>([]);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const [learnError, setLearnError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [nod, setNod] = useState(0);

  // Загрузка раунда: тянем страницы по 200 слов, пока не наберём достаточно
  // (все страницы проходят через общий кэш, поэтому повторные раунды быстрее).
  const [loadPage, setLoadPage] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const eligibleRef = useRef<ListItem[]>([]);
  const processedPagesRef = useRef<Set<number>>(new Set());

  const translationCache = useRef<Map<string, string | null>>(new Map());
  const isLearningRef = useRef(false);

  const pagePath = listId && loadPage !== null
    ? `/api/wordlists/${listId}?page=${loadPage}&pageSize=${FETCH_PAGE_SIZE}`
    : null;

  const { data: pageData, error: pageError } = useApiQuery<WordListPage>(pagePath, {
    enabled: status === 'authenticated'
  });

  const finishBatchLoad = useCallback((eligible: ListItem[]) => {
    translationCache.current.clear();
    setUnknown([]);
    setIndex(0);
    setTranslation({ status: 'hidden' });
    setAddedCount(null);
    setLearnError(false);
    setIsSaving(false);
    setLoadPage(null);

    if (eligible.length === 0) {
      setBatch([]);
      setPhase('empty');
    } else {
      setBatch(shuffle(eligible).slice(0, Math.min(count, eligible.length)));
      setPhase('card');
    }
  }, [count]);

  const startRound = useCallback(() => {
    if (!session?.accessToken || !listId) return;

    eligibleRef.current = [];
    processedPagesRef.current = new Set();
    setPhase('loading');
    setBatch([]);
    setUnknown([]);
    setIndex(0);
    setTranslation({ status: 'hidden' });
    setAddedCount(null);
    setLearnError(false);
    setLoadError(false);
    setRound(value => value + 1);
    setLoadPage(1);
  }, [session?.accessToken, listId]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      startRound();
    }
  }, [status, router, startRound, count, levelsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Накопление слов из пришедшей страницы сборника
  useEffect(() => {
    if (!pageData || loadPage === null || !listId) return;
    // Данные должны относиться именно к запрошенной странице
    if (pageData.page !== undefined && pageData.page !== loadPage) return;

    const requestPath = `/api/wordlists/${listId}?page=${loadPage}&pageSize=${FETCH_PAGE_SIZE}`;
    // Если кэш страницы сброшен (например, после добавления слов), ждём сеть,
    // а не используем устаревшие данные из состояния хука.
    if (peekCache(cacheKey(requestPath, session?.accessToken)) === undefined) return;
    if (processedPagesRef.current.has(loadPage)) return;
    processedPagesRef.current.add(loadPage);

    const pageItems = Array.isArray(pageData.items) ? pageData.items : [];
    const total = pageData.totalItems ?? 0;
    const fresh = pageItems.filter(
      item => !item.inDictionary && (levels.length === 0 || levels.includes(item.cefrLevel.toUpperCase()))
    );
    const eligible = [...eligibleRef.current, ...fresh];
    eligibleRef.current = eligible;

    const target = count * 2; // с запасом, чтобы перемешивание было осмысленным
    const isLastPage =
      pageItems.length < FETCH_PAGE_SIZE ||
      (loadPage - 1) * FETCH_PAGE_SIZE >= total ||
      loadPage >= 50;

    if (eligible.length >= target || isLastPage) {
      finishBatchLoad(eligible);
    } else {
      setLoadPage(loadPage + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageData, round]);

  useEffect(() => {
    if (!pageError) return;
    eligibleRef.current = [];
    setLoadError(true);
    setPhase('empty');
    setLoadPage(null);
  }, [pageError]);

  const currentWord = batch[index];

  const revealTranslation = async () => {
    if (!currentWord) return;
    const word = currentWord.wordText;
    setTranslation({ status: 'loading' });
    if (translationCache.current.has(word)) {
      const cached = translationCache.current.get(word);
      setTranslation(cached ? { status: 'ok', text: cached } : { status: 'error' });
      return;
    }
    try {
      const data = await apiMutate<{ translation?: string }>('/api/ai/translate', {
        token: session?.accessToken,
        method: 'POST',
        body: { word, targetLanguage: 'ru' }
      });
      const text = data && typeof data.translation === 'string' ? data.translation.trim() : '';
      translationCache.current.set(word, text || null);
      setTranslation(text ? { status: 'ok', text } : { status: 'error' });
    } catch {
      translationCache.current.set(word, null);
      setTranslation({ status: 'error' });
    }
  };

  const answer = (known: boolean) => {
    if (!currentWord || isLearningRef.current) return;
    const nextUnknown = known ? unknown : [...unknown, currentWord.wordText];
    setUnknown(nextUnknown);
    if (known) setNod((n) => n + 1);
    if (index < batch.length - 1) {
      setIndex(index + 1);
      setTranslation({ status: 'hidden' });
    } else {
      finishRound(nextUnknown);
    }
  };

  const finishRound = async (words: string[]) => {
    isLearningRef.current = true;
    setIsSaving(true);
    setPhase('finished');
    if (words.length === 0) {
      setAddedCount(0);
      setIsSaving(false);
      isLearningRef.current = false;
      return;
    }
    try {
      const data = await apiMutate<{ added: number; skipped: number }>(`/api/wordlists/${listId}/learn`, {
        token: session?.accessToken,
        method: 'POST',
        body: { words },
        invalidate: ['/api/wordlists', '/api/dictionary']
      });
      if (!data) throw new Error('Failed to learn words');
      setAddedCount(data.added);
      trackEvent('practice_finished', `added:${data.added}`);
    } catch {
      setLearnError(true);
    } finally {
      setIsSaving(false);
      isLearningRef.current = false;
    }
  };

  if (status === 'loading' || phase === 'loading') {
    return (
      <AppLayout>
        <PracticeSkeleton />
      </AppLayout>
    );
  }

  if (loadError) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-lg">
          <ErrorState
            title="Слова не загрузились"
            description="Список сборника не пришёл с сервера. Проверьте соединение и попробуйте снова."
            onRetry={startRound}
            action={
              <Button variant="secondary" onClick={() => router.push(`/dictionary/lists/${listId}`)}>
                К сборнику
              </Button>
            }
          />
        </div>
      </AppLayout>
    );
  }

  if (phase === 'empty') {
    return (
      <AppLayout>
        <div className="mx-auto max-w-lg">
          <EmptyState
            icon={<InboxIcon size={24} />}
            title="Все слова этого уровня уже у вас в словаре"
            description={levels.length > 0
              ? `Для уровней ${levels.join(', ')} в этом сборнике не осталось новых слов.`
              : 'В этом сборнике не осталось новых слов.'}
            action={
              <Button variant="primary" onClick={() => router.push(`/dictionary/lists/${listId}`)}>
                К сборнику
              </Button>
            }
          />
        </div>
      </AppLayout>
    );
  }

  if (phase === 'finished') {
    const knownCount = batch.length - unknown.length;
    return (
      <AppLayout>
        <div className="mx-auto max-w-lg">
          <motion.div variants={variants.enter} initial="hidden" animate="visible" className="card p-8 text-center">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-lg bg-surface-accent text-on-accent">
              <CheckIcon size={24} />
            </div>
            <h1 className="mb-3 text-h1 text-ink">Раунд завершён</h1>
            <p className="mb-6 text-body-lg text-slate">
              Знаете {knownCount} {pluralWords(knownCount)}
              {' · '}в словарь добавлено{' '}
              <span className="font-semibold tabular-nums text-primary">
                {isSaving ? '…' : learnError ? '—' : <AnimatedNumber value={addedCount ?? 0} />}
              </span>
            </p>

            {learnError && (
              <p className="mb-6 text-body-sm text-semantic-error">
                Не удалось добавить незнакомые слова. Попробуйте ещё раз позже.
              </p>
            )}

            {unknown.length > 0 && (
              <div className="mb-8 text-left">
                <h2 className="mb-2 text-body-sm font-semibold text-ink">
                  Слова, отправленные в словарь ({unknown.length})
                </h2>
                <ul className="flex flex-wrap gap-2">
                  {unknown.map(word => (
                    <li
                      key={word}
                      className="rounded-full border border-hairline bg-surface px-2.5 py-1 text-caption text-ink"
                    >
                      {word}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={startRound} variant="primary">
                Ещё раунд
              </Button>
              <Button onClick={() => router.push(`/dictionary/lists/${listId}`)} variant="secondary">
                К сборнику
              </Button>
            </div>
          </motion.div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-lg">
        {/* Прогресс */}
        <div className="mb-6 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex justify-between text-body-sm text-slate">
              <span className="tabular-nums">Слово {index + 1} из {batch.length}</span>
              <span className="tabular-nums">Не знаю: {unknown.length}</span>
            </div>
            <ProgressBar value={((index + 1) / batch.length) * 100} label="Прогресс раунда" />
          </div>
          <LexiPeek mood="neutral" reaction={nod} className="w-12 shrink-0" />
        </div>

        {/* Карточка: каждая следующая приходит со стороны движения вперёд */}
        <AnimatePresence mode="wait" custom={1}>
          <motion.div
            key={`${currentWord.wordText}-${index}`}
            variants={slideVariants(1)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="card mb-6 p-8"
          >
            <div className="mb-8 text-center">
              <LevelChip level={currentWord.cefrLevel} />
              <div className="mb-1 mt-4 flex flex-wrap items-center justify-center gap-3">
                <h1 className="break-words text-h1 text-ink">{currentWord.wordText}</h1>
                <button
                  onClick={() => speak(currentWord.wordText)}
                  className="icon-chip shrink-0 border-transparent bg-transparent hover:bg-surface"
                  title="Произнести"
                  aria-label="Произнести слово"
                >
                  <VolumeIcon size={20} />
                </button>
              </div>

              <div className="mt-8 flex min-h-12 items-center justify-center">
                <AnimatePresence mode="wait">
                  {translation.status === 'hidden' && (
                    <motion.div key="hidden" variants={variants.fadeOnly} initial="hidden" animate="visible" exit="exit">
                      <Button variant="secondary" onClick={revealTranslation}>
                        Показать перевод
                      </Button>
                    </motion.div>
                  )}
                  {translation.status === 'loading' && (
                    <motion.div key="loading" variants={variants.fadeOnly} initial="hidden" animate="visible" exit="exit">
                      <SpinnerIcon size={20} className="animate-spin text-primary" label="Загрузка перевода" />
                    </motion.div>
                  )}
                  {translation.status === 'ok' && (
                    <motion.p
                      key="ok"
                      variants={variants.fadeOnly}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="text-body-lg text-charcoal"
                    >
                      {translation.text}
                    </motion.p>
                  )}
                  {translation.status === 'error' && (
                    <motion.div key="error" variants={variants.fadeOnly} initial="hidden" animate="visible" exit="exit" className="text-center">
                      <p className="mb-2 text-body-sm text-semantic-error">Перевод недоступен</p>
                      <Button variant="secondary" onClick={revealTranslation}>
                        Попробовать снова
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button onClick={() => answer(true)} variant="primary" className="h-12">
                <CheckIcon size={20} />
                Знаю
              </Button>
              <Button onClick={() => answer(false)} variant="danger" className="h-12">
                <CloseIcon size={20} />
                Не знаю
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>

        <Button
          variant="ghost"
          onClick={() => router.push(`/dictionary/lists/${listId}`)}
          className="mx-auto flex"
        >
          <ArrowLeftIcon size={16} />
          К сборнику
        </Button>
      </div>
    </AppLayout>
  );
}

/** Загрузка раунда повторяет карточку: та же колонка, тот же ритм отступов. */
function PracticeSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-lg py-6">
      <span className="sr-only">Загрузка слов для повторения</span>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-6 h-2 w-full rounded-full" />
      <div className="card p-8 text-center">
        <Skeleton className="mx-auto mb-4 h-5 w-10 rounded-full" />
        <Skeleton className="mx-auto mb-3 h-9 w-52" />
        <Skeleton className="mx-auto mb-8 h-5 w-32" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </div>
    </div>
  );
}

export default function PracticePage() {
  return (
    <Suspense
      fallback={
        <AppLayout>
          <PracticeSkeleton />
        </AppLayout>
      }
    >
      <PracticeContent />
    </Suspense>
  );
}
