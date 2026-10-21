'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Button from '@/components/ui/Button';
import ProgressBar from '@/components/ui/ProgressBar';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { ArrowRightIcon, CheckIcon, CloseIcon, TrophyIcon } from '@/components/ui/icons';
import { slideVariants, transition, variants } from '@/lib/motion';
import { pluralWords } from '@/lib/plural';
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

const optionBase =
  'flex w-full items-center justify-between gap-3 rounded-md border px-4 py-3 text-left text-body-sm ' +
  'transition-[background-color,border-color,color,transform] duration-fast ease-soft';

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
  const cardRef = useRef<HTMLDivElement>(null);
  // onClose приходит новой функцией на каждый рендер страницы: через ref слушатель
  // вешается один раз, иначе диалог перехватывал бы фокус на каждое обновление.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Диалог должен принимать фокус и закрываться с Escape — иначе клавиатура остаётся на странице за затемнением.
  useEffect(() => {
    cardRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-4 md:items-center"
      variants={variants.overlay}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-title"
        className="card relative max-h-[90vh] w-full max-w-md overflow-y-auto p-6 text-center shadow-modal outline-none"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={transition.base}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="icon-chip absolute right-3 top-3 border-transparent bg-transparent"
        >
          <CloseIcon className="h-5 w-5" />
        </button>

        <motion.div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-surface-accent text-on-accent"
          variants={variants.feedbackCorrect}
          initial="hidden"
          animate="visible"
        >
          <TrophyIcon className="h-6 w-6" />
        </motion.div>

        <h2 id="finish-title" className="mt-4 text-h1 text-ink">
          Отличная работа!
        </h2>
        <p className="mt-2 text-body text-slate">
          Добавлено{' '}
          <AnimatedNumber value={result.added} className="font-semibold text-ink" />{' '}
          {pluralWords(result.added)} в словарь
        </p>
        <p className="mt-1 text-caption text-slate">Время чтения: {result.minutes} мин</p>

        {showQuiz ? (
          <div className="mt-6 text-left">
            <p className="text-center text-caption text-slate">
              Вопрос {index + 1} из {questions.length}
            </p>
            <ProgressBar
              className="mt-2"
              value={(index / questions.length) * 100}
              label="Прогресс теста"
            />

            <AnimatePresence mode="wait" custom={1}>
              <motion.div key={index} variants={slideVariants(1)} initial="hidden" animate="visible" exit="exit">
                <p className="mt-5 break-words text-center text-h1 text-ink">{current.wordText}</p>
                <div className="mt-4 space-y-2">
                  {current.options.map((opt, i) => {
                    const isCorrect = answer !== null && i === current.correctIndex;
                    const isWrongPick = answer !== null && i === answer && i !== current.correctIndex;
                    // Ошибочный отклик анимируется только у двух затронутых вариантов:
                    // иначе дребезжали бы все строки списка.
                    const feedback = isCorrect
                      ? variants.feedbackCorrect
                      : isWrongPick
                        ? variants.feedbackWrong
                        : undefined;
                    const tone = isCorrect
                      ? 'border-primary bg-surface-success text-on-success'
                      : isWrongPick
                        ? 'border-semantic-error bg-surface-danger text-on-danger'
                        : answer === null
                          ? 'border-hairline-strong bg-canvas text-ink hover:border-primary active:scale-97'
                          : 'border-hairline bg-canvas text-slate';
                    return (
                      <motion.button
                        key={`${opt}-${i}`}
                        type="button"
                        disabled={answer !== null}
                        onClick={() => onAnswer(i)}
                        className={`${optionBase} ${tone}`}
                        variants={feedback}
                        initial={feedback ? 'hidden' : false}
                        animate="visible"
                      >
                        <span>{opt}</span>
                        {isCorrect && <CheckIcon className="h-5 w-5 shrink-0" />}
                        {isWrongPick && <CloseIcon className="h-5 w-5 shrink-0" />}
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            </AnimatePresence>

            {answer !== null && (
              <motion.div variants={variants.fadeOnly} initial="hidden" animate="visible" className="mt-4">
                <Button className="w-full" onClick={onNext}>
                  {hasMore ? 'Далее' : 'Показать результат'}
                  <ArrowRightIcon className="h-4 w-4" />
                </Button>
              </motion.div>
            )}
          </div>
        ) : (
          <>
            {questions.length > 0 && done && (
              <motion.div variants={variants.enter} initial="hidden" animate="visible" className="mt-6">
                <p className="text-h2 text-primary">
                  Результат: <AnimatedNumber value={score} /> из {questions.length}
                </p>
                <ProgressBar
                  className="mx-auto mt-3 max-w-xs"
                  value={(score / questions.length) * 100}
                  label="Верных ответов"
                />
                <p className="mt-4 text-body-sm text-slate">
                  Слова уже в вашем словаре — система подстроит повторения
                </p>
              </motion.div>
            )}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button onClick={onClose}>Читать дальше</Button>
              <Button variant="secondary" onClick={onGoToDictionary}>
                К словарю
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
