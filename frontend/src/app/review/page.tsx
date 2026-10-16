'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTrack } from '@/app/lib/analytics';
import { useSpeech } from '@/hooks/useSpeech';

interface Word {
  wordId: number;
  text: string;
  definitions: {
    definition: string;
    partOfSpeech?: string;
    example?: string;
  }[];
}

export default function ReviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const trackEvent = useTrack();
  const { speak } = useSpeech();
  
  const [words, setWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isFinished, setIsFinished] = useState(false);

  const loadWords = useCallback(async () => {
    try {
      const token = session?.accessToken;
      const res = await fetch('http://localhost:5226/api/review/today', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setWords(data.words);
      setTotalCount(data.totalCount);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to load words:', error);
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (status === 'authenticated') {
      loadWords();
    }
  }, [status, loadWords]);

  // Авто-озвучка при показе нового слова
  useEffect(() => {
    if (words.length > 0 && currentIndex < words.length) {
      speak(words[currentIndex].text);
    }
  }, [currentIndex, words]);

  const handleQuality = async (quality: number) => {
    const word = words[currentIndex];
    
    try {
      const token = session?.accessToken;
      await fetch(`http://localhost:5226/api/review/${word.wordId}/quality/${quality}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      trackEvent('word_reviewed', word.text);

      if (currentIndex < words.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setShowAnswer(false);
      } else {
        setIsFinished(true);
      }
    } catch (error) {
      console.error('Failed to review word:', error);
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[#D6D3CC] border-t-[#356B52] rounded-full animate-spin"></div>
        </div>
      </AppLayout>
    );
  }

  if (isFinished) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto text-center py-12">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#356B52]/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-[#356B52]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#20231F] mb-2">Повторение завершено</h1>
          <p className="text-[#5A5F5A] mb-8">Повторено {words.length} слов</p>
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
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#E7ECE4] flex items-center justify-center">
            <svg className="w-8 h-8 text-[#5A5F5A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#20231F] mb-2">Нет слов на сегодня</h1>
          <p className="text-[#5A5F5A] mb-8">Добавь новые слова в словарь</p>
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
        {/* Прогресс */}
        <div className="mb-8">
          <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
            <span>Слово {currentIndex + 1} из {words.length}</span>
            <span>Всего на сегодня: {totalCount}</span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${((currentIndex + 1) / words.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Карточка */}
        <div className="card p-8 mb-6">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => speak(currentWord.text)}
                className="text-4xl font-bold text-[#20231F] hover:text-[#356B52] transition-colors"
              >
                {currentWord.text}
              </button>
              <button
                onClick={() => speak(currentWord.text)}
                className="p-2 text-xl rounded-full hover:bg-[#E7ECE4] transition-colors"
                title="Произнести"
                aria-label="Произнести слово"
              >
                🔊
              </button>
            </div>
            <p className="text-sm text-[#5A5F5A] mt-2">Нажми для озвучки</p>
          </div>

          {showAnswer ? (
            <div className="border-t border-[#D6D3CC] pt-6">
              {currentWord.definitions.map((def, idx) => (
                <div key={idx} className="text-center">
                  <p className="text-xl text-[#20231F]">{def.definition}</p>
                  {def.partOfSpeech && (
                    <span className="badge badge-primary mt-2">{def.partOfSpeech}</span>
                  )}
                  {def.example && (
                    <div className="mt-4">
                      <p className="text-[#5A5F5A] italic">«{def.example}»</p>
                      <button
                        onClick={() => speak(def.example!)}
                        className="text-sm text-[#356B52] hover:underline mt-1 flex items-center gap-1"
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
          <div className="grid grid-cols-4 gap-3">
            <button
              onClick={() => handleQuality(1)}
              className="py-4 rounded-xl bg-[#B85C5C]/10 text-[#B85C5C] font-medium hover:bg-[#B85C5C] hover:text-white transition-colors"
            >
              Забыл
            </button>
            <button
              onClick={() => handleQuality(3)}
              className="py-4 rounded-xl bg-[#EBCB75]/20 text-[#8B6914] font-medium hover:bg-[#EBCB75] hover:text-[#20231F] transition-colors"
            >
              Трудно
            </button>
            <button
              onClick={() => handleQuality(4)}
              className="py-4 rounded-xl bg-[#4A7C59]/10 text-[#4A7C59] font-medium hover:bg-[#4A7C59] hover:text-white transition-colors"
            >
              Хорошо
            </button>
            <button
              onClick={() => handleQuality(5)}
              className="py-4 rounded-xl bg-[#356B52] text-white font-medium hover:bg-[#2A5542] transition-colors"
            >
              Легко
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}