'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useApiQuery } from '@/app/lib/use-api';

interface Question {
  wordId: number;
  text: string;
  options: string[];
  correctIndex: number;
}

interface QuizResponse {
  questions?: Question[];
}

export default function QuizPage() {
  const { status } = useSession();
  const router = useRouter();

  // Колода теста всегда запрашивается свежей: maxAgeMs: 0. Ответы нигде
  // не сохраняются, поэтому между заходами вопросы не «залипают».
  const { data, error, isLoading, refresh: refreshQuiz } = useApiQuery<QuizResponse>(
    '/api/review/quiz?count=10',
    {
      maxAgeMs: 0,
      enabled: status === 'authenticated',
    }
  );

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [deckLocked, setDeckLocked] = useState(false);

  // Один раз сохраняем загруженную колоду в state и работаем с ней: фоновое
  // обновление не должно подменять вопросы посреди прохождения.
  useEffect(() => {
    if (!data || deckLocked) return;
    setQuestions(data.questions ?? []);
  }, [data, deckLocked]);

  const deck = questions ?? data?.questions ?? [];

  const handleAnswer = (index: number) => {
    if (showResult) return;

    // Дальше колода зафиксирована — поздний ответ сети её не заменит.
    setDeckLocked(true);
    setSelectedAnswer(index);
    setShowResult(true);

    if (index === deck[currentIndex].correctIndex) {
      setScore(score + 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < deck.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    } else {
      setIsFinished(true);
    }
  };

  const restartQuiz = () => {
    setCurrentIndex(0);
    setScore(0);
    setIsFinished(false);
    setSelectedAnswer(null);
    setShowResult(false);
    setDeckLocked(false);
    refreshQuiz();
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    speechSynthesis.speak(utterance);
  };

  // Спиннер — только пока данных ещё нет
  if (isLoading && data === undefined) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin"></div>
        </div>
      </AppLayout>
    );
  }

  // Ошибка загрузки — показываем её и даём повторить, а не уводим молча
  if (error && data === undefined) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto card p-8 text-center">
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Тест не загрузился</h1>
          <p className="text-[var(--color-slate)] mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={refreshQuiz} className="btn-primary">
              Попробовать снова
            </button>
            <button onClick={() => router.push('/dictionary')} className="btn-secondary">
              В словарь
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Колода пустая — не крутим вечный спиннер, а объясняем, что делать
  if (deck.length === 0) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto card p-8 text-center">
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Пока нечего тестировать</h1>
          <p className="text-[var(--color-slate)] mb-6">
            Для теста нужно хотя бы 4 слова в словаре. Добавьте слова из книги или готового сборника — и возвращайтесь.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <button onClick={() => router.push('/dictionary?tab=lists')} className="btn-primary">
              Открыть сборники
            </button>
            <button onClick={() => router.push('/dictionary')} className="btn-secondary">
              Мой словарь
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isFinished) {
    const percentage = Math.round((score / deck.length) * 100);

    return (
      <AppLayout>
        <div className="max-w-md mx-auto text-center py-12">
          <div className={`w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center ${
            percentage >= 80 ? 'bg-[rgba(14,124,123,0.10)]' : percentage >= 50 ? 'bg-[rgba(249,231,159,0.20)]' : 'bg-[rgba(217,45,32,0.10)]'
          }`}>
            <svg className={`w-8 h-8 ${
              percentage >= 80 ? 'text-[var(--color-primary)]' : percentage >= 50 ? 'text-[#7A3A00]' : 'text-[var(--color-error)]'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Тест завершён</h1>
          <p className="text-4xl font-bold text-[var(--color-primary)] my-4">{percentage}%</p>
          <p className="text-[var(--color-slate)] mb-8">
            Правильно {score} из {deck.length}
          </p>
          <div className="flex gap-4 justify-center">
            <button onClick={restartQuiz} className="btn-primary">
              Ещё раз
            </button>
            <button onClick={() => router.push('/dashboard')} className="btn-secondary">
              На главную
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const currentQuestion = deck[currentIndex];

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        {/* Прогресс */}
        <div className="mb-8">
          <div className="flex justify-between text-sm text-[var(--color-slate)] mb-2">
            <span>Вопрос {currentIndex + 1} из {deck.length}</span>
            <span>Score: {score}</span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${((currentIndex + 1) / deck.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Вопрос */}
        <div className="card p-8">
          <p className="text-center text-[var(--color-slate)] mb-4">Выбери правильный перевод:</p>
          
          <button
            onClick={() => speak(currentQuestion.text)}
            className="text-3xl font-bold text-[var(--color-ink)] hover:text-[var(--color-primary)] transition-colors flex items-center justify-center gap-3 mx-auto mb-8"
          >
            {currentQuestion.text}
            <svg className="w-6 h-6 text-[var(--color-slate)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>

          {/* Варианты ответов */}
          <div className="space-y-3">
            {currentQuestion.options.map((option, index) => {
              let buttonClass = "w-full p-4 rounded-lg border-2 text-left transition-all ";
              
              if (showResult) {
                if (index === currentQuestion.correctIndex) {
                  buttonClass += "border-[var(--color-success)] bg-[rgba(26,156,60,0.10)] text-[var(--color-success)]";
                } else if (index === selectedAnswer) {
                  buttonClass += "border-[var(--color-error)] bg-[rgba(217,45,32,0.10)] text-[var(--color-error)]";
                } else {
                  buttonClass += "border-[var(--color-hairline-strong)] text-[var(--color-slate)]";
                }
              } else {
                buttonClass += "border-[var(--color-hairline-strong)] hover:border-[var(--color-primary)] hover:bg-[var(--color-tint-mint)]";
              }

              return (
                <button
                  key={index}
                  onClick={() => handleAnswer(index)}
                  disabled={showResult}
                  className={buttonClass}
                >
                  <span className="font-medium">{option}</span>
                </button>
              );
            })}
          </div>

          {/* Результат */}
          {showResult && (
            <div className="mt-6 text-center">
              <p className={`text-lg font-medium ${selectedAnswer === currentQuestion.correctIndex ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                {selectedAnswer === currentQuestion.correctIndex 
                  ? 'Правильно' 
                  : `Неправильно. Правильный ответ: ${currentQuestion.options[currentQuestion.correctIndex]}`}
              </p>
              
              <button onClick={handleNext} className="btn-primary mt-4">
                {currentIndex < deck.length - 1 ? 'Следующий вопрос' : 'Завершить'}
              </button>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
