'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ApiError, apiMutate } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';

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

  const scoreColor = (score: number) =>
    score >= 80
      ? 'text-[var(--color-success)]'
      : score >= 55
        ? 'text-[var(--color-primary)]'
        : 'text-[var(--color-error)]';

  if (status === 'loading') {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-1">Письмо</h1>
          <p className="text-sm text-[var(--color-slate)]">
            Напишите текст на английском — Alex проверит грамматику, подскажет естественные формулировки
            и покажет исправленную версию.
          </p>
        </div>

        {/* Темы */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
          {TOPICS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTopicId(item.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                item.id === topicId
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                  : 'bg-white text-[var(--color-slate)] border-[var(--color-hairline-strong)] hover:border-[var(--color-primary)]'
              }`}
            >
              {item.title}
            </button>
          ))}
        </div>

        <div className="card p-6 mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">{topic.title}</h2>
            <span className="text-xs px-2 py-1 rounded-full bg-[var(--color-tint-mint)] text-[var(--color-primary)]">
              {topic.level}
            </span>
          </div>
          <p className="text-sm text-[var(--color-slate)] leading-relaxed">{topic.prompt}</p>
          <p className="text-xs text-[var(--color-slate)] mt-2">
            Ориентир по объёму: от {topic.minWords} слов
          </p>
        </div>

        <div className="card p-6 mb-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
            rows={9}
            placeholder="Write your text in English…"
            className="input w-full resize-y min-h-[200px] mb-2"
            spellCheck
          />
          <div className="flex items-center justify-between text-xs text-[var(--color-slate)] mb-4">
            <span>{wordCount} слов</span>
            <span className={text.length > MAX_LENGTH - 100 ? 'text-[var(--color-error)]' : ''}>
              {text.length} / {MAX_LENGTH}
            </span>
          </div>

          <button
            onClick={submit}
            disabled={checking || !text.trim()}
            className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {checking ? 'Проверяем текст…' : 'Проверить текст'}
          </button>

          {error && (
            <p className="text-sm text-[var(--color-error)] mt-3 text-center">{error}</p>
          )}
        </div>

        {analysis && (
          <div className="card p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-[var(--color-slate)]">Оценка</p>
                <p className={`text-4xl font-bold ${scoreColor(analysis.score)}`}>{analysis.score}</p>
              </div>
              <span
                className={`text-sm font-medium px-3 py-1 rounded-full ${
                  analysis.isCorrect
                    ? 'bg-[rgba(26,156,60,0.10)] text-[var(--color-success)]'
                    : 'bg-[rgba(249,231,159,0.30)] text-[#7A3A00]'
                }`}
              >
                {analysis.isCorrect ? 'Без серьёзных ошибок' : 'Есть что улучшить'}
              </span>
            </div>

            <div className="progress-bar mb-4">
              <div className="progress-fill" style={{ width: `${analysis.score}%` }} />
            </div>

            {analysis.praise && (
              <p className="text-sm text-[var(--color-ink)] mb-5">{analysis.praise}</p>
            )}

            {analysis.issues && analysis.issues.length > 0 && (
              <div className="mb-5">
                <p className="text-sm font-medium text-[var(--color-ink)] mb-2">
                  Разбор ({analysis.issues.length})
                </p>
                <ul className="space-y-3">
                  {analysis.issues.map((issue, index) => (
                    <li
                      key={index}
                      className="p-3 rounded-lg border border-[var(--color-hairline-strong)] bg-white"
                    >
                      <p className="text-sm text-[var(--color-ink)] leading-snug">
                        <span className="line-through text-[var(--color-error)]">{issue.original}</span>
                        <span className="mx-1.5 text-[var(--color-slate)]">→</span>
                        <span className="text-[var(--color-success)]">{issue.suggestion}</span>
                      </p>
                      {issue.explanation && (
                        <p className="text-xs text-[var(--color-slate)] mt-1">{issue.explanation}</p>
                      )}
                      {issue.type && (
                        <span className="inline-block mt-2 text-[10px] uppercase tracking-wide text-[var(--color-slate)]">
                          {issue.type}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.betterVersion && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-[var(--color-ink)]">Исправленная версия</p>
                  <button
                    onClick={copyBetter}
                    className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline-strong)] text-[var(--color-slate)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                  >
                    {copied ? 'Скопировано' : 'Скопировать'}
                  </button>
                </div>
                <div className="p-4 rounded-lg bg-[var(--color-tint-mint)] border border-[var(--color-hairline-strong)]">
                  <p className="text-[var(--color-ink)] whitespace-pre-wrap leading-relaxed">
                    {analysis.betterVersion}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3 mt-5">
              <button onClick={() => { setAnalysis(null); setText(''); }} className="btn-secondary">
                Новый текст
              </button>
              <Link href="/translator" className="btn-secondary">
                Обсудить с Alex
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
