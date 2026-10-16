'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';
import { useTrack } from '@/app/lib/analytics';
import { useSpeech } from '@/hooks/useSpeech';

interface ListItem {
  wordText: string;
  cefrLevel: string;
  freqRank: number;
  inDictionary: boolean;
}

const FETCH_PAGE_SIZE = 200; // максимум, который принимает бэкенд

const cefrStyles: Record<string, string> = {
  A1: 'bg-[#5A5F5A]/10 text-[#5A5F5A]',
  A2: 'bg-[#356B52]/10 text-[#356B52]',
  B1: 'bg-[#EBCB75]/15 text-[#8a6d1d]',
  B2: 'bg-[#EBCB75]/25 text-[#7a5c10]',
  C1: 'bg-[#356B52]/20 text-[#356B52]',
  C2: 'bg-[#356B52]/20 text-[#356B52]'
};

function LevelChip({ level }: { level: string }) {
  const cls = cefrStyles[level] || cefrStyles.A1;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {level}
    </span>
  );
}

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

  const [phase, setPhase] = useState<Phase>('loading');
  const [batch, setBatch] = useState<ListItem[]>([]);
  const [index, setIndex] = useState(0);
  const [translation, setTranslation] = useState<TranslationState>({ status: 'hidden' });
  const [unknown, setUnknown] = useState<string[]>([]);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const [learnError, setLearnError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const translationCache = useRef<Map<string, string | null>>(new Map());
  const isLearningRef = useRef(false);

  const loadBatch = useCallback(async () => {
    if (!session?.accessToken || !listId) return;
    setPhase('loading');
    setLoadError(false);
    setAddedCount(null);
    setLearnError(false);
    try {
      const token = session.accessToken;
      const eligible: ListItem[] = [];
      const target = count * 2; // с запасом, чтобы перемешивание было осмысленным
      let page = 1;
      let total = Infinity;
      while (eligible.length < target && (page - 1) * FETCH_PAGE_SIZE < total && page <= 50) {
        const res = await fetch(
          `${API_URL}/api/wordlists/${listId}?page=${page}&pageSize=${FETCH_PAGE_SIZE}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error('Failed to load list');
        const data: { items: ListItem[]; totalItems: number } = await res.json();
        total = data.totalItems ?? 0;
        for (const item of data.items) {
          if (!item.inDictionary && (levels.length === 0 || levels.includes(item.cefrLevel.toUpperCase()))) {
            eligible.push(item);
          }
        }
        if (data.items.length < FETCH_PAGE_SIZE) break;
        page++;
      }

      translationCache.current.clear();
      setUnknown([]);
      setIndex(0);
      setTranslation({ status: 'hidden' });

      if (eligible.length === 0) {
        setBatch([]);
        setPhase('empty');
      } else {
        setBatch(shuffle(eligible).slice(0, Math.min(count, eligible.length)));
        setPhase('card');
      }
    } catch {
      setLoadError(true);
      setPhase('empty');
    }
  }, [session, listId, count, levels.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      loadBatch();
    }
  }, [status, router, loadBatch]);

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
      const res = await fetch(`${API_URL}/api/ai/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.accessToken}`
        },
        body: JSON.stringify({ word, targetLanguage: 'ru' })
      });
      const data = res.ok ? await res.json().catch(() => null) : null;
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
      const res = await fetch(`${API_URL}/api/wordlists/${listId}/learn`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ words })
      });
      if (!res.ok) throw new Error('Failed to learn words');
      const data: { added: number; skipped: number } = await res.json();
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
        <div className="max-w-lg mx-auto flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-[#D6D3CC] border-t-[#356B52] rounded-full animate-spin"></div>
        </div>
      </AppLayout>
    );
  }

  if (loadError) {
    return (
      <AppLayout>
        <div className="max-w-lg mx-auto text-center py-16">
          <div className="card p-8">
            <p className="text-[#B85C5C] mb-6">Не удалось загрузить слова. Проверьте соединение и попробуйте снова.</p>
            <div className="flex justify-center gap-3">
              <button onClick={loadBatch} className="btn-primary">Попробовать снова</button>
              <button onClick={() => router.push(`/dictionary/lists/${listId}`)} className="btn-secondary">
                К сборнику
              </button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (phase === 'empty') {
    return (
      <AppLayout>
        <div className="max-w-lg mx-auto text-center py-16">
          <div className="card p-8">
            <div className="text-4xl mb-4">🎉</div>
            <h1 className="text-xl font-bold text-[#20231F] mb-2">
              Все слова этого уровня уже у вас в словаре
            </h1>
            <p className="text-[#5A5F5A] mb-8">
              {levels.length > 0
                ? `Для уровней ${levels.join(', ')} в этом сборнике не осталось новых слов.`
                : 'В этом сборнике не осталось новых слов.'}
            </p>
            <button onClick={() => router.push(`/dictionary/lists/${listId}`)} className="btn-primary">
              К сборнику
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (phase === 'finished') {
    const knownCount = batch.length - unknown.length;
    return (
      <AppLayout>
        <div className="max-w-lg mx-auto text-center py-12">
          <div className="card p-8">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#356B52]/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-[#356B52]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-[#20231F] mb-2">Раунд завершён</h1>
            <p className="text-[#5A5F5A] mb-6">
              Знали: <span className="font-semibold text-[#356B52]">{knownCount}</span>
              {' · '}
              Добавлено в словарь:{' '}
              <span className="font-semibold text-[#356B52]">
                {isSaving ? '…' : learnError ? '—' : addedCount ?? 0}
              </span>
            </p>

            {learnError && (
              <p className="text-sm text-[#B85C5C] mb-6">
                Не удалось добавить незнакомые слова. Попробуйте ещё раз позже.
              </p>
            )}

            {unknown.length > 0 && (
              <div className="mb-8 text-left">
                <p className="text-sm font-semibold text-[#20231F] mb-2">
                  Слова, отправленные в словарь ({unknown.length}):
                </p>
                <div className="flex flex-wrap gap-2">
                  {unknown.map(word => (
                    <span
                      key={word}
                      className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#F7F5EF] border border-[#D6D3CC] text-[#20231F]"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-center gap-3">
              <button onClick={loadBatch} className="btn-primary">
                Ещё раунд
              </button>
              <button onClick={() => router.push(`/dictionary/lists/${listId}`)} className="btn-secondary">
                К сборнику
              </button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-lg mx-auto">
        {/* Прогресс */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
            <span>Слово {index + 1} из {batch.length}</span>
            <span>Не знаю: {unknown.length}</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill transition-all duration-300"
              style={{ width: `${((index + 1) / batch.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Карточка */}
        <div className="card p-8 mb-6">
          <div className="text-center mb-8">
            <LevelChip level={currentWord.cefrLevel} />
            <div className="flex items-center justify-center gap-3 mt-4 mb-1">
              <h1 className="text-4xl font-bold text-[#20231F] break-words">{currentWord.wordText}</h1>
              <button
                onClick={() => speak(currentWord.wordText)}
                className="p-2 text-xl rounded-full hover:bg-[#E7ECE4] transition-colors shrink-0"
                title="Произнести"
                aria-label="Произнести слово"
              >
                🔊
              </button>
            </div>

            <div className="mt-8 min-h-[3rem] flex items-center justify-center">
              {translation.status === 'hidden' && (
                <button
                  onClick={revealTranslation}
                  className="text-sm font-medium text-[#356B52] hover:underline transition-colors"
                >
                  Показать перевод
                </button>
              )}
              {translation.status === 'loading' && (
                <div className="w-5 h-5 border-2 border-[#D6D3CC] border-t-[#356B52] rounded-full animate-spin"></div>
              )}
              {translation.status === 'ok' && (
                <p className="text-lg text-[#5A5F5A]">{translation.text}</p>
              )}
              {translation.status === 'error' && (
                <div className="text-center">
                  <p className="text-sm text-[#B85C5C] mb-2">Перевод недоступен</p>
                  <button
                    onClick={revealTranslation}
                    className="text-sm text-[#356B52] hover:underline transition-colors"
                  >
                    Попробовать снова
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => answer(true)}
              className="py-3 rounded-xl font-semibold bg-[#356B52] text-white hover:bg-[#2d5a44] transition-colors"
            >
              Знаю ✓
            </button>
            <button
              onClick={() => answer(false)}
              className="py-3 rounded-xl font-semibold bg-[#B85C5C] text-white hover:bg-[#a04f4f] transition-colors"
            >
              Не знаю ✗
            </button>
          </div>
        </div>

        <div className="text-center">
          <button
            onClick={() => router.push(`/dictionary/lists/${listId}`)}
            className="text-sm text-[#5A5F5A] hover:text-[#356B52] transition-colors"
          >
            ← К сборнику
          </button>
        </div>
      </div>
    </AppLayout>
  );
}

export default function PracticePage() {
  return (
    <Suspense
      fallback={
        <AppLayout>
          <div className="max-w-lg mx-auto flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-[#D6D3CC] border-t-[#356B52] rounded-full animate-spin"></div>
          </div>
        </AppLayout>
      }
    >
      <PracticeContent />
    </Suspense>
  );
}
