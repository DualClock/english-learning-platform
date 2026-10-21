'use client';

import { useApiQuery } from '@/app/lib/use-api';

interface LeagueEntry {
  rank: number;
  name: string;
  weeklyXp: number;
  league: string;
  leagueTitle: string;
  level: number;
  levelTitle: string;
  cefrLevel: string | null;
  isMe: boolean;
}

interface Leaderboard {
  weekStart: string;
  weekEnd: string;
  participants: number;
  leagues: { code: string; title: string; minXp: number }[];
  me: {
    rank: number | null;
    weeklyXp: number;
    league: string;
    leagueTitle: string;
    nextLeagueXp: number | null;
    nextLeagueTitle: string | null;
    xpToNextLeague: number | null;
    level: number;
    levelTitle: string;
    inTop: boolean;
  };
  entries: LeagueEntry[];
}

const LEAGUE_ICONS: Record<string, string> = {
  bronze: '🥉',
  silver: '🥈',
  gold: '🥇',
  platinum: '💠',
  diamond: '💎',
};

function formatRange(start: string, end: string): string {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '';
  return `${from.toLocaleDateString('ru-RU', options)} — ${to.toLocaleDateString('ru-RU', options)}`;
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/**
 * Лига недели: рейтинг по XP, набранному с понедельника.
 * Источник — GET /api/progress/leaderboard (топ-20 + своя позиция).
 */
export default function WeeklyLeague() {
  const { data, isLoading } = useApiQuery<Leaderboard>('/api/progress/leaderboard');

  if (isLoading && !data) {
    return <div className="card p-6 mb-6 h-40 animate-pulse bg-white" />;
  }

  if (!data) return null;

  const { me, entries, leagues } = data;
  const myLeague = leagues.find((l) => l.code === me.league);

  // Прогресс внутри лиги: от её порога до порога следующей
  const leagueStart = myLeague?.minXp ?? 0;
  const leagueEnd = me.nextLeagueXp ?? leagueStart;
  const leaguePercent = leagueEnd > leagueStart
    ? Math.min(100, Math.round(((me.weeklyXp - leagueStart) / (leagueEnd - leagueStart)) * 100))
    : 100;

  return (
    <section className="card p-6 mb-6" aria-label="Лига недели">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">Лига недели</h2>
        <span className="text-sm text-[var(--color-slate)]">
          {formatRange(data.weekStart, data.weekEnd)} · {data.participants}{' '}
          {plural(data.participants, ['участник', 'участника', 'участников'])}
        </span>
      </div>

      {/* Своя позиция и лига */}
      <div className="rounded-xl bg-[var(--color-tint-mint)] p-4 mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-3xl" aria-hidden="true">{LEAGUE_ICONS[me.league] ?? '🏅'}</span>
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold text-[var(--color-ink)]">
                {me.leagueTitle}
                {me.rank != null && (
                  <span className="ml-2 text-sm font-normal text-[var(--color-slate)]">
                    {me.rank} место из {data.participants}
                  </span>
                )}
              </p>
              <p className="text-sm text-[var(--color-slate)]">
                <strong className="text-[var(--color-ink)]">{me.weeklyXp}</strong> XP за неделю
              </p>
            </div>

            <div
              className="mt-2 h-2 rounded-full bg-[rgba(201,205,212,0.40)] overflow-hidden"
              role="progressbar"
              aria-valuenow={leaguePercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-[var(--color-primary)] transition-all"
                style={{ width: `${leaguePercent}%` }}
              />
            </div>

            <p className="text-xs text-[var(--color-slate)] mt-1.5">
              {me.nextLeagueTitle != null
                ? `До лиги «${me.nextLeagueTitle}» — ${me.xpToNextLeague} XP`
                : 'Максимальная лига недели — держите темп'}
              {me.rank == null && ' · на этой неделе XP ещё не было'}
            </p>
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-[var(--color-slate)]">
          На этой неделе ещё никто не набрал XP — сделайте первое повторение и возглавьте лигу.
        </p>
      ) : (
        <ol className="divide-y divide-[var(--color-hairline-strong)]">
          {entries.map((entry) => (
            <li
              key={`${entry.rank}-${entry.name}`}
              className={`flex items-center gap-3 py-2.5 ${entry.isMe ? 'font-semibold' : ''}`}
            >
              <span
                className={`w-7 shrink-0 text-center text-sm ${
                  entry.rank <= 3 ? 'text-[var(--color-primary)]' : 'text-[var(--color-slate)]'
                }`}
              >
                {entry.rank}
              </span>
              <span className="text-lg shrink-0" aria-hidden="true">
                {LEAGUE_ICONS[entry.league] ?? '🏅'}
              </span>
              <span className="flex-1 min-w-0 truncate text-[var(--color-ink)]">
                {entry.name}
                {entry.isMe && <span className="ml-2 text-xs text-[var(--color-primary)]">это вы</span>}
              </span>
              <span className="shrink-0 text-sm text-[var(--color-slate)] hidden sm:inline">
                ур. {entry.level}
                {entry.cefrLevel && ` · ${entry.cefrLevel.toUpperCase()}`}
              </span>
              <span className="w-16 shrink-0 text-right text-sm text-[var(--color-ink)]">{entry.weeklyXp} XP</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
