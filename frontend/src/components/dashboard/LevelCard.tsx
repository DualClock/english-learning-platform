'use client';

import Link from 'next/link';
import { useApiQuery } from '@/app/lib/use-api';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import ProgressBar from '@/components/ui/ProgressBar';
import { Skeleton } from '@/components/ui/LoadingState';
import { ArrowRightIcon } from '@/components/ui/icons';

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
    return (
      <section className="card mb-8" aria-busy="true">
        <div className="flex items-center gap-5">
          <Skeleton className="h-14 w-14 rounded-lg" />
          <div className="min-w-0 grow space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
      </section>
    );
  }

  const latest = data.achievements.find((a) => a.unlocked);

  return (
    <section className="card mb-8" aria-label="Уровень и достижения">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-accent text-primary">
          <span className="text-caption text-slate">ур.</span>
          <AnimatedNumber value={data.level} className="text-h2 leading-none tabular-nums" />
        </div>

        <div className="min-w-0 grow basis-52">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-h3 text-ink">{data.levelTitle}</h2>
            <span className="text-caption text-slate tabular-nums">
              <AnimatedNumber value={data.xp} /> XP
              {data.xpToNextLevel != null && ` · ещё ${data.xpToNextLevel} XP до ${data.level + 1} ур.`}
            </span>
          </div>
          <ProgressBar value={data.levelProgressPercent} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-caption text-slate">
            <span>
              Достижения: <strong className="font-semibold text-ink">{data.unlockedCount}</strong> из{' '}
              {data.achievements.length}
              {latest && ` · последнее: ${latest.title}`}
            </span>
            <Link
              href="/progress"
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            >
              Весь прогресс
              <ArrowRightIcon size={16} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
