'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApiQuery } from '@/app/lib/use-api';
import { useTts } from '@/hooks/useTts';

interface Question {
  wordId: number;
  text: string;
  options: string[];
  correctIndex: number;
}

interface QuizResponse {
  questions?: Question[];
  // Поля чекпоинта: обычный quiz их не присылает
  level?: string;
  reason?: string;
  passScore?: number;
  totalQuestions?: number;
  matchedWords?: number;
  dictionaryWords?: number;
}

type QuizMode = 'reading' | 'listening';

const LEVEL_LABELS: Record<string, string> = {
  a1: 'A1',
  a2: 'A2',
  b1: 'B1',
  b2: 'B2',
};

function QuizContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ?checkpoint=b1 переключает страницу в режим чекпоинт-теста уровня:
  // те же вопросы quiz, но отобранные по CEFR-уровню слов пользователя
  const checkpointLevel = (searchParams.get('checkpoint') ?? '').trim().toLowerCase() || null;
  const levelLabel = checkpointLevel ? LEVEL_LABELS[checkpointLevel] ?? checkpointLevel.toUpperCase() : null;

  // Колода теста всегда запрашивается свежей: maxAgeMs: 0. Ответы нигде
  // не сохраняются, поэтому между заходами вопросы не «залипают».
  const { data, error, isLoading, refresh: refreshQuiz } = useApiQuery<QuizResponse>(
    checkpointLevel
      ? `/api/practice/checkpoint?level=${encodeURIComponent(checkpointLevel)}`
      : '/api/review/quiz?count=10',
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
  const [mode, setMode] = useState<QuizMode>('reading');

  const { play, isLoading: audioLoading } = useTts();

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

  // Режим аудирования: слово не показываем — звучит озвучка, варианты остаются
  // переводами. Переозвучиваем при переходе к следующему вопросу.
  useEffect(() => {
    if (mode !== 'listening' || isFinished) return;
    const question = deck[currentIndex];
    if (!question) return;
    const timer = window.setTimeout(() => {
      void play(question.text);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentIndex, isFinished, deck.length]);

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
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">
            {checkpointLevel ? `Чекпоинт ${levelLabel} пока недоступен` : 'Пока нечего тестировать'}
          </h1>
          <p className="text-[var(--color-slate)] mb-4">
            {checkpointLevel
              ? 'Для чекпоинта нужно хотя бы 4 слова с переводами в словаре — иначе не собрать варианты ответов.'
              : 'Для теста нужно хотя бы 4 слова в словаре. Добавьте слова из книги или готового сборника — и возвращайтесь.'}
          </p>
          {checkpointLevel && data && (
            <p className="text-sm text-[var(--color-slate)] mb-6">
              Слов в словаре: <strong className="text-[var(--color-ink)]">{data.dictionaryWords ?? 0}</strong>
              {data.matchedWords != null && (
                <> · из них уровня {levelLabel}: <strong className="text-[var(--color-ink)]">{data.matchedWords}</strong></>
              )}
            </p>
          )}
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
    const passed = checkpointLevel ? score >= (data?.passScore ?? Math.ceil(deck.length * 0.8)) : percentage >= 80;
    const passScore = data?.passScore ?? Math.ceil(deck.length * 0.8);

    return (
      <AppLayout>
        <div className="max-w-md mx-auto text-center py-12">
          <div className={`w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center ${
            passed ? 'bg-[rgba(14,124,123,0.10)]' : percentage >= 50 ? 'bg-[rgba(249,231,159,0.20)]' : 'bg-[rgba(217,45,32,0.10)]'
          }`}>
            <svg className={`w-8 h-8 ${
              passed ? 'text-[var(--color-primary)]' : percentage >= 50 ? 'text-[#7A3A00]' : 'text-[var(--color-error)]'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">
            {checkpointLevel ? `Чекпоинт ${levelLabel}: ${passed ? 'сдан' : 'не сдан'}` : 'Тест завершён'}
          </h1>
          <p className="text-4xl font-bold text-[var(--color-primary)] my-4">{percentage}%</p>
          <p className="text-[var(--color-slate)] mb-2">
            Правильно {score} из {deck.length}
          </p>
          {checkpointLevel && (
            <p className="text-sm text-[var(--color-slate)] mb-8">
              {passed
                ? `Порог ${passScore} пройден — уровень ${levelLabel} можно подтверждать дальше.`
                : `Для зачёта нужно ${passScore} верных ответов из ${deck.length}. Повторите слова уровня и попробуйте снова.`}
            </p>
          )}
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
        {checkpointLevel && (
          <div className="card p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--color-slate)]">Чекпоинт-тест</p>
              <p className="text-lg font-semibold text-[var(--color-ink)]">
                Уровень {levelLabel} · {deck.length} вопросов
              </p>
            </div>
            <div className="text-right text-sm text-[var(--color-slate)]">
              <p>
                Порог: <strong className="text-[var(--color-ink)]">{data?.passScore ?? Math.ceil(deck.length * 0.8)}</strong> верных
              </p>
              {data?.matchedWords != null && (
                <p>
                  Слов {levelLabel} в словаре: <strong className="text-[var(--color-ink)]">{data.matchedWords}</strong>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Режим: чтение или аудирование */}
        <div className="flex justify-center gap-2 mb-6" role="tablist" aria-label="Режим теста">
          {([
            { id: 'reading', label: '📖 Чтение' },
            { id: 'listening', label: '🎧 Аудирование' },
          ] as const).map((option) => (
            <button
              key={option.id}
              role="tab"
              aria-selected={mode === option.id}
              onClick={() => setMode(option.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                mode === option.id
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                  : 'bg-white text-[var(--color-slate)] border-[var(--color-hairline-strong)] hover:border-[var(--color-primary)]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

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
          <p className="text-center text-[var(--color-slate)] mb-4">
            {mode === 'listening'
              ? 'Выбери перевод того, что слышишь:'
              : 'Выбери правильный перевод:'}
          </p>

          {mode === 'listening' ? (
            <div className="flex flex-col items-center mb-8">
              <button
                onClick={() => play(currentQuestion.text)}
                disabled={audioLoading}
                aria-label="Прослушать слово"
                className="w-24 h-24 rounded-full bg-[var(--color-primary)] text-white text-4xl flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {audioLoading ? (
                  <span className="w-7 h-7 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  '🔊'
                )}
              </button>
              <button
                onClick={() => play(currentQuestion.text)}
                className="mt-3 text-sm text-[var(--color-slate)] hover:text-[var(--color-primary)] transition-colors"
              >
                Прослушать ещё раз
              </button>
              {showResult && (
                <p className="mt-4 text-2xl font-bold text-[var(--color-ink)]">
                  {currentQuestion.text}
                </p>
              )}
            </div>
          ) : (
            <button
              onClick={() => play(currentQuestion.text)}
              className="text-3xl font-bold text-[var(--color-ink)] hover:text-[var(--color-primary)] transition-colors flex items-center justify-center gap-3 mx-auto mb-8"
            >
              {currentQuestion.text}
              <svg className="w-6 h-6 text-[var(--color-slate)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            </button>
          )}

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

// useSearchParams требует Suspense-границы при статическом рендере
export default function QuizPage() {
  return (
    <Suspense
      fallback={
        <AppLayout>
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin"></div>
          </div>
        </AppLayout>
      }
    >
      <QuizContent />
    </Suspense>
  );
}
