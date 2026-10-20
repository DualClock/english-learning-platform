'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTrack } from '@/app/lib/analytics';
import { useSpeech } from '@/hooks/useSpeech';
import { useApiQuery } from '@/app/lib/use-api';
import { apiMutate } from '@/app/lib/api-client';

interface Word {
  wordId: number;
  text: string;
  definitions: {
    definition: string;
    partOfSpeech?: string;
    example?: string;
  }[];
  isNew?: boolean;
  isLeech?: boolean;
}

interface ReviewTodayResponse {
  totalCount?: number;
  reviewCount?: number;
  newCount?: number;
  words?: Word[];
}

export default function ReviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const trackEvent = useTrack();
  const { speak } = useSpeech();

  // Сессия повторения: колода всегда запрашивается свежей (maxAgeMs: 0),
  // но после первой загрузки работаем с локальным снимком — ответы и позиция
  // не должны «мигать» из-за фонового обновления или перерисовок.
  const { data, isLoading } = useApiQuery<ReviewTodayResponse>('/api/review/today', {
    maxAgeMs: 0,
    enabled: status === 'authenticated',
  });

  const [words, setWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [nextHint, setNextHint] = useState('');
  const [reviewCount, setReviewCount] = useState(0);
  const [newCount, setNewCount] = useState(0);

  // Один раз сохраняем загруженную колоду в state и дальше работаем с ней.
  useEffect(() => {
    if (!data || sessionStarted) return;
    setWords(data.words ?? []);
    setTotalCount(data.totalCount ?? data.words?.length ?? 0);
    setReviewCount(data.reviewCount ?? 0);
    setNewCount(data.newCount ?? 0);
  }, [data, sessionStarted]);

  // Авто-озвучка при показе нового слова
  useEffect(() => {
    if (words.length > 0 && currentIndex < words.length) {
      speak(words[currentIndex].text);
    }
  }, [currentIndex, words]);

  const handleQuality = async (quality: number) => {
    const word = words[currentIndex];
    if (!word) return;

    setSessionStarted(true);
    setSaveError('');

    try {
      const outcome = await apiMutate<{ interval: number; intervalMinutes: number }>(
        `/api/review/${word.wordId}/quality/${quality}`,
        {
          token: session?.accessToken,
          method: 'POST',
          invalidate: ['/api/review/today', '/api/progress/streak'],
        }
      );
      trackEvent('word_reviewed', word.text);

      setNextHint(
        outcome?.intervalMinutes && outcome.intervalMinutes > 0
          ? `Следующее повторение через ${outcome.intervalMinutes} мин — слово вернётся в этой сессии`
          : `Следующее повторение через ${outcome?.interval ?? 1} дн.`
      );

      if (currentIndex < words.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setShowAnswer(false);
      } else {
        setIsFinished(true);
      }
    } catch {
      setSaveError('Не удалось сохранить ответ. Проверьте соединение и попробуйте ещё раз.');
    }
  };

  // Скелетон/спиннер — только пока данных ещё нет
  if (isLoading && data === undefined) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin"></div>
        </div>
      </AppLayout>
    );
  }

  if (isFinished) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto text-center py-12">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[rgba(14,124,123,0.10)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--color-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Повторение завершено</h1>
          <p className="text-[var(--color-slate)] mb-8">Повторено {words.length} слов</p>
          <button onClick={() => router.push('/dashboard')} className="btn-primary">
            На главную
          </button>
        </div>
      </AppLayout>
    );
  }

  if (words.length === 0) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto text-center py-12">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[var(--color-tint-mint)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--color-slate)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Нет слов на сегодня</h1>
          <p className="text-[var(--color-slate)] mb-8">Добавь новые слова в словарь</p>
          <button onClick={() => router.push('/dictionary/add')} className="btn-primary">
            Добавить слово
          </button>
        </div>
      </AppLayout>
    );
  }

  const currentWord = words[currentIndex];

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        {saveError && (
          <div
            role="alert"
            className="mb-4 p-4 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)]"
          >
            {saveError}
          </div>
        )}

        {/* Прогресс */}
        <div className="mb-8">
          <div className="flex justify-between text-sm text-[var(--color-slate)] mb-2">
            <span>Слово {currentIndex + 1} из {words.length}</span>
            <span>
              {reviewCount > 0 || newCount > 0
                ? `${reviewCount} на повторение · ${newCount} новых`
                : `Всего на сегодня: ${totalCount}`}
            </span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${((currentIndex + 1) / words.length) * 100}%` }}
            />
          </div>
          {nextHint && (
            <p className="text-xs text-[var(--color-slate)] mt-2">{nextHint}</p>
          )}
        </div>

        {/* Карточка */}
        <div className="card p-8 mb-6">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => speak(currentWord.text)}
                className="text-4xl font-bold text-[var(--color-ink)] hover:text-[var(--color-primary)] transition-colors"
              >
                {currentWord.text}
              </button>
              <button
                onClick={() => speak(currentWord.text)}
                className="p-2 text-xl rounded-full hover:bg-[var(--color-tint-mint)] transition-colors"
                title="Произнести"
                aria-label="Произнести слово"
              >
                🔊
              </button>
            </div>
            {currentWord.isNew && (
              <span className="badge badge-primary text-xs mt-3 inline-block">Новое слово</span>
            )}
            {currentWord.isLeech && (
              <span className="badge text-xs mt-3 ml-2 inline-block bg-[rgba(249,231,159,0.30)] text-[#7A3A00]">
                Трудное слово
              </span>
            )}
            <p className="text-sm text-[var(--color-slate)] mt-2">Нажми для озвучки</p>
          </div>

          {showAnswer ? (
            <div className="border-t border-[var(--color-hairline-strong)] pt-6">
              {currentWord.definitions.map((def, idx) => (
                <div key={idx} className="text-center">
                  <p className="text-xl text-[var(--color-ink)]">{def.definition}</p>
                  {def.partOfSpeech && (
                    <span className="badge badge-primary mt-2">{def.partOfSpeech}</span>
                  )}
                  {def.example && (
                    <div className="mt-4">
                      <p className="text-[var(--color-slate)] italic">«{def.example}»</p>
                      <button
                        onClick={() => speak(def.example!)}
                        className="text-sm text-[var(--color-primary)] hover:underline mt-1 flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                        Озвучить пример
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center">
              <button
                onClick={() => setShowAnswer(true)}
                className="btn-secondary"
              >
                Показать ответ
              </button>
            </div>
          )}
        </div>

        {/* Кнопки оценки */}
        {showAnswer && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => handleQuality(1)}
              className="py-4 rounded-lg bg-[rgba(217,45,32,0.10)] text-[var(--color-error)] font-medium hover:bg-[var(--color-error)] hover:text-white transition-colors"
            >
              Забыл
            </button>
            <button
              onClick={() => handleQuality(3)}
              className="py-4 rounded-lg bg-[rgba(249,231,159,0.20)] text-[#7A3A00] font-medium hover:bg-[var(--color-tint-yellow-bold)] hover:text-[var(--color-ink)] transition-colors"
            >
              Трудно
            </button>
            <button
              onClick={() => handleQuality(4)}
              className="py-4 rounded-lg bg-[rgba(26,156,60,0.10)] text-[var(--color-success)] font-medium hover:bg-[var(--color-success)] hover:text-white transition-colors"
            >
              Хорошо
            </button>
            <button
              onClick={() => handleQuality(5)}
              className="py-4 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary-pressed)] transition-colors"
            >
              Легко
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
