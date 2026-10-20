'use client';

import Link from 'next/link';
import { useApiQuery } from '@/app/lib/use-api';

interface Achievement {
  code: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
  target: number;
}

interface UserProgress {
  xp: number;
  level: number;
  levelTitle: string;
  levelStartXp: number;
  nextLevelXp: number | null;
  xpToNextLevel: number | null;
  levelProgressPercent: number;
  achievements: Achievement[];
  unlockedCount: number;
}

export default function LevelCard() {
  const { data } = useApiQuery<UserProgress>('/api/progress/achievements');

  if (!data) {
    return <div className="card p-5 mb-8 h-24 animate-pulse bg-white" />;
  }

  const latest = data.achievements.find((a) => a.unlocked);

  return (
    <section className="card p-5 mb-8" aria-label="Уровень и достижения">
      <div className="flex flex-wrap items-center gap-5">
        <div className="w-14 h-14 shrink-0 rounded-2xl bg-[var(--color-tint-mint)] flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-slate)]">ур.</span>
          <span className="text-xl font-bold text-[var(--color-primary)] leading-none">{data.level}</span>
        </div>

        <div className="flex-1 min-w-[200px]">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <h2 className="text-base font-semibold text-[var(--color-ink)]">{data.levelTitle}</h2>
            <span className="text-xs text-[var(--color-slate)]">
              {data.xp} XP
              {data.xpToNextLevel != null && ` · ещё ${data.xpToNextLevel} XP до ${data.level + 1} ур.`}
            </span>
          </div>
          <div
            className="h-2 rounded-full bg-[rgba(201,205,212,0.40)] overflow-hidden"
            role="progressbar"
            aria-valuenow={data.levelProgressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-all"
              style={{ width: `${data.levelProgressPercent}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-slate)]">
            <span>
              Достижения: <strong className="text-[var(--color-ink)]">{data.unlockedCount}</strong> из{' '}
              {data.achievements.length}
              {latest && ` · последнее: ${latest.icon} ${latest.title}`}
            </span>
            <Link href="/progress" className="font-medium text-[var(--color-primary)] hover:underline">
              Весь прогресс →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
