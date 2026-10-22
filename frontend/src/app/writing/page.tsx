'use client';

import AppLayout from '@/components/AppLayout';
import LexiPeek from '@/components/brand/lexi/LexiPeek';
import { issueTypeLabel } from '@/components/assistant/AnalysisCard';
import Button from '@/components/ui/Button';
import LevelChip from '@/components/ui/LevelChip';
import LoadingState from '@/components/ui/LoadingState';
import Notice from '@/components/ui/Notice';
import PageHeader from '@/components/ui/PageHeader';
import ProgressBar from '@/components/ui/ProgressBar';
import { CheckIcon, CloseIcon, SpinnerIcon } from '@/components/ui/icons';
import { Tag } from '@/components/ui/Badge';
import { AnimatePresence, motion } from 'motion/react';
import { variants } from '@/lib/motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ApiError, apiMutate } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';
import { pluralWords } from '@/lib/plural';

interface WritingTopic {
  id: string;
  title: string;
  prompt: string;
  level: string;
  minWords: number;
}

interface AssistantIssue {
  type?: string;
  original?: string;
  suggestion?: string;
  explanation?: string;
}

interface Analysis {
  score: number;
  isCorrect: boolean;
  issues?: AssistantIssue[];
  betterVersion?: string;
  praise?: string;
}

const TOPICS: WritingTopic[] = [
  {
    id: 'letter-friend',
    title: 'Письмо другу',
    prompt:
      'Напишите письмо другу о том, как прошла ваша неделя: что нового случилось, что вас порадовало и что вы планируете на выходные.',
    level: 'A2–B1',
    minWords: 60,
  },
  {
    id: 'my-city',
    title: 'Мой город',
    prompt:
      'Опишите место в вашем городе, которое вы любите больше всего. Где оно находится, почему оно важно для вас и что там можно делать.',
    level: 'A2–B1',
    minWords: 60,
  },
  {
    id: 'opinion-online',
    title: 'Учёба онлайн',
    prompt:
      'Как вы считаете, онлайн-обучение лучше обычного? Приведите два аргумента за и один против, сделайте вывод.',
    level: 'B1–B2',
    minWords: 100,
  },
  {
    id: 'job-interview',
    title: 'Письмо работодателю',
    prompt:
      'Напишите короткое письмо работодателю: какая вакансия вас интересует, какой у вас опыт и почему вы подходите на эту роль.',
    level: 'B1–B2',
    minWords: 100,
  },
  {
    id: 'travel-story',
    title: 'История о поездке',
    prompt:
      'Расскажите о поездке, которая запомнилась вам больше всего: куда вы ездили, с кем, что произошло и что вы поняли.',
    level: 'B1',
    minWords: 80,
  },
  {
    id: 'technology',
    title: 'Технологии в жизни',
    prompt:
      'Какая технология изменила вашу жизнь сильнее всего? Опишите, как вы её используете и что было бы без неё.',
    level: 'B2',
    minWords: 120,
  },
  {
    id: 'advice',
    title: 'Совет другу',
    prompt:
      'Друг хочет начать учить английский, но не знает с чего начать. Напишите ему письмо с тремя конкретными советами.',
    level: 'A2–B1',
    minWords: 70,
  },
  {
    id: 'book-review',
    title: 'Отзыв о книге',
    prompt:
      'Напишите отзыв о книге или фильме: о чём он, что понравилось, что нет и кому бы вы его рекомендовали.',
    level: 'B1–B2',
    minWords: 100,
  },
];

const MAX_LENGTH = 2000;

export default function WritingPage() {
  const { data: session, status } = useSession();
  const { data: profile } = useApiQuery<{ cefrLevel?: string | null }>('/api/profile');

  const [topicId, setTopicId] = useState(TOPICS[0].id);
  const [text, setText] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const topic = useMemo(
    () => TOPICS.find((item) => item.id === topicId) ?? TOPICS[0],
    [topicId]
  );

  const wordCount = useMemo(
    () => text.trim().split(/\s+/).filter(Boolean).length,
    [text]
  );

  useEffect(() => {
    setAnalysis(null);
    setError('');
  }, [topicId]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || checking) return;

    setChecking(true);
    setError('');
    setAnalysis(null);

    try {
      const result = await apiMutate<Analysis>('/api/assistant/analyze', {
        token: session?.accessToken,
        method: 'POST',
        body: {
          text: trimmed,
          userLevel: profile?.cefrLevel ?? undefined,
        },
      });

      setAnalysis(result);

      // XP за письменную практику: отдельный вызов, чтобы начисление
      // не зависело от того, удался ли разбор
      void apiMutate('/api/practice/writing/submitted', {
        token: session?.accessToken,
        method: 'POST',
        body: { wordCount },
      }).catch(() => {
        /* опыт — побочный эффект, ошибку не показываем */
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Не удалось проверить текст: сервер недоступен. Попробуйте позже.'
      );
    } finally {
      setChecking(false);
    }
  }, [checking, profile?.cefrLevel, session?.accessToken, text, wordCount]);

  const copyBetter = async () => {
    if (!analysis?.betterVersion) return;
    try {
      await navigator.clipboard.writeText(analysis.betterVersion);
      setCopied(true);
    } catch {
      setError('Браузер не дал скопировать текст. Выделите его вручную.');
    }
  };

  /** Пороги числа: 80 — успех, 55 — рабочий акцент, ниже — ошибка. */
  const scoreColor = (score: number) =>
    score >= 80
      ? 'text-semantic-success'
      : score >= 55
        ? 'text-primary'
        : 'text-semantic-error';

  if (status === 'loading') {
    return (
      <AppLayout>
        <LoadingState rows={3} label="Загрузка темы для письма" />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Письмо"
          subtitle="Напишите текст на английском — Alex проверит грамматику, подскажет естественные формулировки и покажет исправленную версию."
        />

        {/* Темы: перенос, а не горизонтальный скролл — все восемь должны быть видно сразу */}
        <div className="mb-4 flex flex-wrap gap-2">
          {TOPICS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTopicId(item.id)}
              aria-pressed={item.id === topicId}
              className={`shrink-0 ${item.id === topicId ? 'chip-button-active' : 'chip-button'}`}
            >
              {item.title}
            </button>
          ))}
        </div>

        <div className="card mb-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-h3 text-ink">{topic.title}</h2>
            <LevelChip level={topic.level}>{topic.level}</LevelChip>
          </div>
          <p className="max-w-measure text-body-sm leading-relaxed text-slate">{topic.prompt}</p>
          <p className="mt-2 text-caption text-slate">
            Ориентир по объёму: от {topic.minWords} {pluralWords(topic.minWords)}
          </p>
        </div>

        <div className="relative card mb-4">
          {/* Читает поверх твоего текста: чем больше написано, тем выше поднимает глаза */}
          <div className="absolute -top-9 right-6 z-10">
            <LexiPeek
              mood="neutral"
              focus={{ x: -0.6, y: 0.9 - Math.min(text.length / 400, 1) * 1.7 }}
              className="w-16"
            />
          </div>
          <label className="sr-only" htmlFor="writing-text">
            Текст письма на английском
          </label>
          <textarea
            id="writing-text"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
            rows={9}
            placeholder="Write your text in English…"
            className="input mb-2 min-h-52 resize-y"
            spellCheck
          />
          <div className="mb-4 flex items-center justify-between text-caption text-slate">
            <span>
              {wordCount} {pluralWords(wordCount)}
            </span>
            <span className={text.length > MAX_LENGTH - 100 ? 'text-semantic-error' : undefined}>
              {text.length} / {MAX_LENGTH}
            </span>
          </div>

          <Button onClick={submit} disabled={checking || !text.trim()} className="w-full">
            {checking ? (
              <>
                <SpinnerIcon size={16} />
                Проверяем текст…
              </>
            ) : (
              'Проверить текст'
            )}
          </Button>

          {error && (
            <div className="mt-3">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {analysis && (
            <motion.div
              key="writing-analysis"
              variants={variants.enter}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="card mb-6"
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-body-sm text-slate">Оценка</p>
                  <p className={`text-h1 leading-none ${scoreColor(analysis.score)}`}>
                    {analysis.score}
                  </p>
                </div>
                <Tag tone={analysis.isCorrect ? 'success' : 'warning'}>
                  {analysis.isCorrect ? 'Без серьёзных ошибок' : 'Есть что улучшить'}
                </Tag>
              </div>

              <ProgressBar value={analysis.score} label="Оценка текста" className="mb-4" />

              {analysis.praise && (
                <p className="mb-5 max-w-measure text-body-sm text-ink">{analysis.praise}</p>
              )}

              {analysis.issues && analysis.issues.length > 0 && (
                <div className="mb-5">
                  <p className="mb-2 text-body-sm font-medium text-ink">
                    Разбор ({analysis.issues.length})
                  </p>
                  <ul className="stagger space-y-3">
                    {analysis.issues.map((issue, index) => (
                      <li key={index} className="rounded-lg border border-hairline bg-surface p-3">
                        {issue.type && (
                          <span className="text-caption uppercase tracking-wide text-slate">
                            {issueTypeLabel(issue.type)}
                          </span>
                        )}
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                          <span className="inline-flex items-center gap-1 text-semantic-error">
                            <CloseIcon size={16} />
                            {issue.original}
                          </span>
                          <span className="text-slate">→</span>
                          <span className="inline-flex items-center gap-1 font-medium text-semantic-success">
                            <CheckIcon size={16} />
                            {issue.suggestion}
                          </span>
                        </p>
                        {issue.explanation && (
                          <p className="mt-1 text-caption text-slate">{issue.explanation}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.betterVersion && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-body-sm font-medium text-ink">Исправленная версия</p>
                    <Button
                      variant="ghost"
                      onClick={copyBetter}
                      className="px-2 py-1 text-caption"
                    >
                      {copied ? 'Скопировано' : 'Скопировать'}
                    </Button>
                  </div>
                  <div className="rounded-lg border border-hairline bg-surface-success p-4">
                    <p className="max-w-measure whitespace-pre-wrap leading-relaxed text-ink">
                      {analysis.betterVersion}
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAnalysis(null);
                    setText('');
                  }}
                >
                  Новый текст
                </Button>
                <Button variant="secondary" href="/translator">
                  Обсудить с Alex
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
