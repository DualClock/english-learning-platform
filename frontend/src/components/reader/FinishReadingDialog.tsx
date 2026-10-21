'use client';

import type { FinishResult, QuizQuestion } from './types';

interface Props {
  result: FinishResult;
  questions: QuizQuestion[];
  index: number;
  answer: number | null;
  score: number;
  done: boolean;
  onAnswer: (choice: number) => void;
  onNext: () => void;
  onClose: () => void;
  onGoToDictionary: () => void;
}

/** Итог главы: сколько слов добавлено, и мини-тест по ним. */
export default function FinishReadingDialog({
  result,
  questions,
  index,
  answer,
  score,
  done,
  onAnswer,
  onNext,
  onClose,
  onGoToDictionary,
}: Props) {
  const current = questions[index];
  const showQuiz = questions.length > 0 && !done && current;
  const hasMore = index + 1 < questions.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(26,29,35,0.50)] p-4">
      <div className="card max-w-md w-full p-8 text-center max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Отличная работа! 🎉</h2>
        <p className="text-[var(--color-slate)] mb-1">Добавлено {result.added} слов в словарь</p>
        <p className="text-[var(--color-slate)] mb-6">Время чтения: {result.minutes} мин</p>

        {showQuiz ? (
          <div className="text-left">
            <p className="text-xs text-[var(--color-slate)] mb-3 text-center">
              Вопрос {index + 1} из {questions.length}
            </p>
            <p className="text-3xl font-bold text-[var(--color-ink)] text-center mb-6 break-words">
              {current.wordText}
            </p>
            <div className="space-y-2 mb-4">
              {current.options.map((opt, i) => {
                let cls = 'bg-white border-[var(--color-hairline-strong)] hover:bg-[var(--color-tint-mint)]';
                if (answer !== null) {
                  if (i === current.correctIndex) {
                    cls = 'bg-[var(--color-tint-mint)] border-[var(--color-primary)] text-[var(--color-primary)]';
                  } else if (i === answer) {
                    cls = 'bg-[rgba(217,45,32,0.10)] border-[var(--color-error)] text-[var(--color-error)]';
                  } else {
                    cls = 'bg-white border-[var(--color-hairline-strong)] opacity-60';
                  }
                }
                return (
                  <button
                    key={i}
                    disabled={answer !== null}
                    onClick={() => onAnswer(i)}
                    className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-colors ${cls}`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {answer !== null && (
              <button onClick={onNext} className="w-full btn-primary">
                {hasMore ? 'Далее' : 'Показать результат'}
              </button>
            )}
          </div>
        ) : questions.length > 0 && done ? (
          <div>
            <p className="text-xl font-semibold text-[var(--color-primary)] mb-2">
              Результат: {score} из {questions.length}
            </p>
            <p className="text-sm text-[var(--color-slate)] mb-6">
              Слова уже в вашем словаре — система подстроит повторения
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={onClose} className="btn-primary">
                Читать дальше
              </button>
              <button onClick={onGoToDictionary} className="btn-secondary">
                К словарю
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 justify-center">
            <button onClick={onClose} className="btn-primary">
              Читать дальше
            </button>
            <button onClick={onGoToDictionary} className="btn-secondary">
              К словарю
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
