'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AnimatePresence, motion } from 'motion/react';
import LexiMascot from '@/components/brand/lexi/LexiMascot';
import { apiGet } from '@/app/lib/api-client';
import { CloseIcon } from '@/components/ui/icons';
import {
  ACHIEVEMENT_RARITY_CLASS,
  ACHIEVEMENT_RARITY_LABEL,
  achievementRarity,
} from './achievementMeta';

interface SmallAchievement {
  code: string;
  title: string;
  description: string;
  unlocked: boolean;
  unlockedAt: string | null;
  target: number;
}

interface ProgressPayload {
  achievements: SmallAchievement[];
}

function seenKey(userKey: string): string {
  return `lexicon:achievements-seen:${userKey}`;
}

/** null — ключа ещё нет, это первый заход и старые достижения не celebration. */
function readSeen(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : null;
  } catch {
    return null;
  }
}

function writeSeen(key: string, codes: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(new Set(codes))));
  } catch {
    // без localStorage достижение просто не запомнится
  }
}

/**
 * Тихий момент открытия: проверяет прогресс после действий и показывает
 * один неблокирующий тост с Lexi. Старые достижения при первом заходе
 * только запоминаются, чтобы не высыпать пачку уведомлений.
 */
export default function AchievementCelebration() {
  const { data: session } = useSession();

  const userKey = session?.user?.id || session?.user?.email || 'user';
  const [newAchievements, setNewAchievements] = useState<SmallAchievement[] | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async (force: boolean) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const data = await apiGet<ProgressPayload>('/api/progress/achievements', {
        force,
        maxAgeMs: force ? 0 : 60_000,
      });

      const unlocked = (data.achievements ?? []).filter((achievement) => achievement.unlocked);
      const key = seenKey(userKey);
      const seen = readSeen(key);

      if (seen === null) {
        writeSeen(key, unlocked.map((achievement) => achievement.code));
        return;
      }

      const fresh = unlocked.filter((achievement) => !seen.includes(achievement.code));
      if (fresh.length === 0) return;

      writeSeen(key, [...seen, ...fresh.map((achievement) => achievement.code)]);
      setNewAchievements(fresh);
    } catch {
      // достижения не должны мешать действиям
    } finally {
      inFlightRef.current = false;
    }
  }, [userKey]);

  // Первый заход за сессию: инициализируем seen или покажем то, что реально ново.
  useEffect(() => {
    void check(false);
  }, [check]);

  // После ответов, чтения, слов и практик api-client посылает это событие.
  useEffect(() => {
    const onProgressChanged = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void check(true);
      }, 900);
    };

    window.addEventListener('lexicon:progress-changed', onProgressChanged);
    return () => {
      window.removeEventListener('lexicon:progress-changed', onProgressChanged);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [check]);

  useEffect(() => {
    if (!newAchievements) return;
    const timer = setTimeout(() => setNewAchievements(null), 9000);
    return () => clearTimeout(timer);
  }, [newAchievements]);

  const items = newAchievements ?? [];
  const first = items[0];
  const rare = first ? achievementRarity(first.target) : 'common';
  const title = first
    ? items.length === 1
      ? first.title
      : `Новых достижений: ${items.length}`
    : '';
  const description = first
    ? items.length === 1
      ? first.description
      : items.slice(0, 3).map((achievement) => achievement.title).join(' · ')
    : '';
  const label = items.length === 1 ? 'Новое достижение' : 'Новые достижения';

  return (
    <AnimatePresence>
      {first && (
        <motion.div
          key="achievement-toast"
          data-achievement-toast
          role="status"
          aria-live="polite"
          /*
           * На мобиле карточка достижения поднимается над нижней панелью
           * навигации: bottom-[4.5rem] = 56px панели + 16px зазора. Без этого
           * тост упирался в таб-бар и обрезал собственную ссылку.
           */
          className="pointer-events-none fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 sm:bottom-[max(1rem,env(safe-area-inset-bottom))] sm:left-auto sm:right-6 sm:w-[24rem]"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
        >
          <div className="card pointer-events-auto flex items-start gap-3 p-4 shadow-modal">
            <LexiMascot pose="celebrate" className="w-16 shrink-0" />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-caption font-semibold uppercase tracking-wide text-primary">
                  {label}
                </p>
                <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${ACHIEVEMENT_RARITY_CLASS[rare]}`}>
                  {ACHIEVEMENT_RARITY_LABEL[rare]}
                </span>
              </div>
              <p className="mt-1 text-body-sm font-semibold text-ink">{title}</p>
              <p className="mt-0.5 line-clamp-2 text-caption leading-snug text-slate">{description}</p>
              <Link
                href="/progress#achievements"
                onClick={() => setNewAchievements(null)}
                className="mt-2 inline-flex text-caption font-medium text-primary hover:underline"
              >
                Открыть коллекцию
              </Link>
            </div>

            <button
              type="button"
              onClick={() => setNewAchievements(null)}
              aria-label="Скрыть уведомление"
              className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded text-slate transition-colors duration-fast ease-soft hover:bg-surface hover:text-ink"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
