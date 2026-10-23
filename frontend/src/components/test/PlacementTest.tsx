'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Button from '@/components/ui/Button';
import ChoiceCard from '@/components/ui/ChoiceCard';
import LevelChip from '@/components/ui/LevelChip';
import Notice from '@/components/ui/Notice';
import ProgressBar from '@/components/ui/ProgressBar';
import LexiPeek from '@/components/brand/lexi/LexiPeek';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  SpinnerIcon,
  TargetIcon,
} from '@/components/ui/icons';
import {
  GUEST_EVENTS,
  guestPassKeys,
  trackGuest,
  type GuestPassKeys,
} from '@/app/lib/analytics';
import { fetchPlacementQuestions, submitPlacementAnswers } from '@/app/lib/placement-api';
import {
  buildPlacementAnswers,
  getLevelGuide,
  readingPickCaption,
  type PlacementQuestion,
  type PlacementResult,
} from '@/lib/placement';
import { variants } from '@/lib/motion';

/*
 * Публичный тест уровня (W2.2a) — тот же placement, что в онбординге, но без
 * регистрации: ссылка из Telegram/VK/Дзена должна вести на пользу за три минуты,
 * а не на «создай аккаунт».
 *
 * Уровень считает сервер (`POST api/profile/placement/result`, [AllowAnonymous]),
 * здесь только листание вопросов и состояния экрана. Ничего не сохраняется: ровно
 * поэтому единственный честный CTA под результатом — «сохранить результат», то
 * есть регистрация.
 */

/**
 * Замер верха воронки (W2.4). Раньше это событие уходило в
 * `/api/analytics/event` и получало молчаливый 401: тот путь закрыт
 * `[Authorize]`, а `track()` ошибки глотает. Теперь гостевые события идут на
 * отдельный анонимный эндпоинт с whitelist из двух имён — `placement_test_started`
 * (вопросы загружены) и `placement_test_completed` (человек увидел уровень).
 *
 * «Ушёл до результата» здесь не отправляется: с /test это не доставляется
 * надёжно, а врущая метрика хуже отсутствующей. Незакрывшие тест видны как
 * `starts − completions` в `/api/analytics/acquisition`.
 */

type Phase = 'idle' | 'loading' | 'question' | 'scoring' | 'result';

export default function PlacementTest() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [questions, setQuestions] = useState<PlacementQuestion[]>([]);
  const [index, setIndex] = useState(0);
  /** Ответы по индексу вопроса: «назад» возвращает выбор, а не пустой экран */
  const [choices, setChoices] = useState<(number | null)[]>([]);
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [error, setError] = useState('');

  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const completedTracked = useRef(false);
  /**
   * Ключи одного прохода теста. Нужны, чтобы сетевой повтор (обрыв связи,
   * ретрай браузера) не превратился в двух гостей: сервер видит тот же
   * dedupeKey и молча игнорирует вторую строку.
   */
  const passKeys = useRef<GuestPassKeys | null>(null);

  /**
   * Новый проход: генерируем ключи и говорим серверу, что тест начали.
   * Вызывается только когда вопросы реально показали: «открыл страницу» и
   * «начал тест» — разные вещи, и вторая и есть верх воронки.
   */
  const beginPass = useCallback(() => {
    const keys = guestPassKeys();
    passKeys.current = keys;
    void trackGuest(GUEST_EVENTS.testStarted, { dedupeKey: keys.started });
  }, []);

  const start = useCallback(async () => {
    setError('');
    setPhase('loading');
    try {
      const list = await fetchPlacementQuestions();
      if (list.length === 0) throw new Error('empty question list');
      setQuestions(list);
      setChoices(list.map(() => null));
      setIndex(0);
      setPhase('question');
      beginPass();
    } catch {
      setError('Не удалось загрузить вопросы. Проверьте соединение и попробуйте ещё раз.');
      setPhase('idle');
    }
  }, [beginPass]);

  const score = useCallback(async (list: PlacementQuestion[], answers: (number | null)[]) => {
    setError('');
    setPhase('scoring');
    try {
      const next = await submitPlacementAnswers(buildPlacementAnswers(list, answers));
      setResult(next);
      setPhase('result');
    } catch {
      // Ответы целы: повтор не заставляет человека проходить тест заново.
      setError('Сервер не ответил. Ваши ответы сохранены на этом экране — попробуйте ещё раз.');
      setPhase('question');
    }
  }, []);

  const isLast = index === questions.length - 1;

  const goNext = () => {
    if (!isLast) {
      setIndex(index + 1);
      return;
    }
    void score(questions, choices);
  };

  const goBack = () => {
    setError('');
    if (index === 0) {
      setPhase('idle');
      return;
    }
    setIndex(index - 1);
  };

  const restart = () => {
    setResult(null);
    setChoices(questions.map(() => null));
    setIndex(0);
    setError('');
    completedTracked.current = false;
    // Новый проход = новые ключи: иначе второй результат гостя сервер
    // посчитал бы повтором первого и выбросил.
    beginPass();
    setPhase('question');
  };

  // Показ результата = конец пути. Событие отправляем один раз на проход.
  useEffect(() => {
    if (phase !== 'result' || !result || completedTracked.current) return;
    completedTracked.current = true;
    // Ключ прохода создан в beginPass(); фолбэк на случай, если результат
    // оказался на экране раньше (чужой рендер, восстановление из кэша).
    void trackGuest(GUEST_EVENTS.testCompleted, {
      level: result.cefrLevel,
      dedupeKey: (passKeys.current ?? guestPassKeys()).completed,
    });
  }, [phase, result]);

  const selectChoice = (choice: number) => {
    setError('');
    setChoices((prev) => {
      const next = [...prev];
      next[index] = choice;
      return next;
    });
  };

  /*
   * Радиогруппа живёт по стрелкам: ArrowDown/Up/Left/Right переставляют выбор и
   * фокус (как в нативных radio), Tab не выгоняет из группы. Пробел и Enter
   * работают сами — вариант остаётся `<button>`.
   */
  const onOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, position: number) => {
    const count = questions[index]?.options.length ?? 0;
    if (count === 0) return;

    let target: number | null = null;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        target = (position + 1) % count;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        target = (position - 1 + count) % count;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = count - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    selectChoice(target);
    optionRefs.current[target]?.focus();
  };

  if (phase === 'idle') {
    return (
      <div>
        {error && (
          <div className="mb-4" aria-live="polite">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <Button onClick={start} className="w-full py-4 text-body">
          <TargetIcon size={20} />
          {error ? 'Попробовать снова' : 'Начать тест'}
        </Button>
        <p className="mt-3 text-caption text-slate">
          16 вопросов от простых к сложным. Регистрация не нужна, результат ничего
          не сохраняет на сервере.
        </p>
      </div>
    );
  }

  if (phase === 'loading' || phase === 'scoring') {
    const scoring = phase === 'scoring';
    return (
      <div role="status" aria-live="polite" className="py-6 text-center">
        <span className="state-orb bg-surface-accent text-on-accent">
          <SpinnerIcon size={24} className="h-8 w-8" />
        </span>
        <p className="text-body-lg text-ink">
          {scoring ? 'Считаем ваш уровень…' : 'Загружаем вопросы…'}
        </p>
      </div>
    );
  }

  if (phase === 'result' && result) {
    const guide = getLevelGuide(result.cefrLevel);
    return (
      <motion.div
        variants={variants.enter}
        initial="hidden"
        animate="visible"
        /* Результат приходит вместо спиннера: без live-региона скринридер его
           не озвучил бы — экран молча сменился бы под пальцем. */
        role="status"
        aria-live="polite"
      >
        <div className="text-center">
          <LexiPeek mood="proud" className="mx-auto mb-2 w-32" />
          <p className="text-body-sm font-medium text-primary">Ваш уровень</p>
          <h2 className="mt-1 text-h1 text-ink">
            {guide.code}
            {guide.name ? ` — ${guide.name}` : ''}
          </h2>
          <p className="mx-auto mt-3 max-w-measure text-body-lg text-slate">{guide.readout}</p>
          <p className="mt-4 flex items-center justify-center gap-2 text-body-sm text-slate">
            <CheckIcon size={16} className="text-primary" aria-hidden />
            Правильных ответов: <b className="font-semibold text-ink">{result.correctCount}</b> из{' '}
            <b className="font-semibold text-ink">{result.total}</b>
          </p>
        </div>

        {guide.picks.length > 0 && (
          <section className="mt-8" aria-labelledby="placement-next-reading">
            <h3 id="placement-next-reading" className="text-h3 text-ink">
              Что читать на {guide.code} в Lexicon
            </h3>
            <ul className="mt-3 space-y-3">
              {guide.picks.map((pick) => (
                <li
                  key={pick.title}
                  className="flex items-start justify-between gap-4 rounded-lg border border-hairline bg-canvas p-4"
                >
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-ink">{pick.title}</span>
                    <span className="mt-1 block text-body-sm text-slate">
                      {pick.author} · {readingPickCaption(pick)}
                    </span>
                  </span>
                  <LevelChip level={pick.level} className="shrink-0" />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-8">
          {/*
           * Результат гостя нигде не сохранён — сервер только посчитал уровень.
           * Предзаполнить уровень в онбординге нельзя: страница онбординга не
           * читает query-параметры, поэтому ссылка ведёт туда как есть.
           */}
          <Button href="/onboarding" className="w-full py-4 text-body">
            Сохранить результат и получать слова на повторение
            <ArrowRightIcon size={20} aria-hidden />
          </Button>
          {/*
           * Рядом с «вступить» — вторая дверь (W3.3): когорта для тех, кому
           * нужен формат с датой старта и компанией, а не «сам когда хочу».
           */}
          <Link
            href="/beta"
            className="mt-3 flex items-center justify-center gap-2 text-body-sm text-slate underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            Или вступить в когорту со 2 ноября
            <ArrowRightIcon size={16} aria-hidden />
          </Link>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={restart}
              className="text-body-sm text-slate underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
            >
              Пройти заново
            </button>
            <Link
              href="/"
              className="text-body-sm text-slate underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
            >
              На главную
            </Link>
          </div>
        </div>
      </motion.div>
    );
  }

  const question = questions[index];
  const promptId = `placement-question-${question.id}`;
  const selected = choices[index];

  return (
    <div>
      <AnimatePresence mode="wait">
        <motion.div
          key={`${phase}:${index}`}
          variants={variants.enter}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <p role="status" aria-live="polite" className="mb-1 text-body-sm font-medium text-primary">
            Вопрос {index + 1} из {questions.length}
          </p>
          <ProgressBar
            value={((index + 1) / questions.length) * 100}
            label={`Вопрос ${index + 1} из ${questions.length}`}
            className="mb-6"
          />

          <h2 id={promptId} className="mb-6 text-h2 text-ink">
            {question.prompt}
          </h2>

          <div role="radiogroup" aria-labelledby={promptId} className="mb-8 space-y-3">
            {question.options.map((option, position) => (
              <ChoiceCard
                key={`${question.id}:${position}`}
                ref={(node) => {
                  optionRefs.current[position] = node;
                }}
                size="lg"
                asRadio
                selected={selected === position}
                title={option}
                tabIndex={selected === null ? (position === 0 ? 0 : -1) : selected === position ? 0 : -1}
                onKeyDown={(event) => onOptionKeyDown(event, position)}
                onSelect={() => selectChoice(position)}
              />
            ))}
          </div>

          {error && (
            <div className="mb-6" aria-live="polite">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}

          {/* Кнопки внизу: большой палец дотягивается без прокрутки */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={goBack} className="shrink-0">
              <ArrowLeftIcon size={16} />
              Назад
            </Button>
            <Button onClick={goNext} disabled={selected === null} className="flex-1">
              {error ? 'Посчитать снова' : isLast ? 'Показать результат' : 'Далее'}
              <ArrowRightIcon size={16} />
            </Button>
          </div>

          <p className="mt-4 text-center text-caption text-slate">
            Уровень считает сервер по всем 16 ответам, а не по последнему вопросу.
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
