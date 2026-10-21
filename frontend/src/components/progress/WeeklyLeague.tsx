'use client';

import { useApiQuery } from '@/app/lib/use-api';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import ProgressBar from '@/components/ui/ProgressBar';
import {
  GemIcon,
  MedalIcon,
  SparkIcon,
  StarIcon,
  TrophyIcon,
  type IconProps,
  type IconSize,
} from '@/components/ui/icons';

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

/*
 * Ступени лиги — свои иконки вместо эмодзи-медалей: форма несёт смысл
 * (место в таблице), а не цвет металла.
 */
const LEAGUE_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  bronze: MedalIcon,
  silver: StarIcon,
  gold: TrophyIcon,
  platinum: GemIcon,
  diamond: SparkIcon,
};

function LeagueIcon({ league, size = 20 }: { league: string; size?: IconSize }) {
  const Icon = LEAGUE_ICONS[league] ?? TrophyIcon;
  return <Icon size={size} />;
}

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
    return (
      <section className="card mb-6 p-6" aria-label="Лига недели">
        <LoadingState rows={4} label="Загрузка лиги недели" />
      </section>
    );
  }

  // Блок факультативный: без лидерборда экран прогресса остаётся полезным.
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
    <section className="card mb-6 p-6" aria-label="Лига недели">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h3 text-ink">Лига недели</h2>
        <span className="text-body-sm text-slate">
          {formatRange(data.weekStart, data.weekEnd)} · {data.participants}{' '}
          {plural(data.participants, ['участник', 'участника', 'участников'])}
        </span>
      </div>

      {/* Своя позиция и лига */}
      <div className="mb-5 rounded-xl bg-surface-accent p-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-canvas text-on-accent">
            <LeagueIcon league={me.league} size={24} />
          </span>
          <div className="min-w-52 flex-1">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-semibold text-ink">
                {me.leagueTitle}
                {me.rank != null && (
                  <span className="ml-2 text-body-sm font-normal text-slate">
                    № {me.rank} из {data.participants}
                  </span>
                )}
              </p>
              <p className="text-body-sm text-slate">
                <strong className="text-ink">{me.weeklyXp}</strong> XP за неделю
              </p>
            </div>

            {/* Трек — цвет подложки панели: на цветной плашке hairline теряется. */}
            <ProgressBar className="mt-2 bg-canvas" value={leaguePercent} label="Прогресс в лиге недели" />

            <p className="mt-1.5 text-caption text-slate">
              {me.nextLeagueTitle != null
                ? `До лиги «${me.nextLeagueTitle}» — ${me.xpToNextLeague} XP`
                : 'Максимальная лига недели — держите темп'}
              {me.rank == null && ' · на этой неделе XP ещё не было'}
            </p>
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          variant="inline"
          className="border border-hairline"
          icon={<TrophyIcon size={24} />}
          title="На этой неделе ещё никто не набрал XP"
          description="Сделайте первое повторение и возглавьте лигу."
        />
      ) : (
        <ol className="stagger divide-y divide-hairline">
          {entries.map((entry) => (
            <li
              key={`${entry.rank}-${entry.name}`}
              className={`flex items-center gap-3 py-2.5 ${entry.isMe ? 'font-semibold' : ''}`}
            >
              <span
                className={`w-7 shrink-0 text-center text-body-sm ${
                  entry.rank <= 3 ? 'text-primary' : 'text-slate'
                }`}
              >
                {entry.rank}
              </span>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas text-slate">
                <LeagueIcon league={entry.league} size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">
                {entry.name}
                {entry.isMe && <span className="ml-2 text-caption text-primary">это вы</span>}
              </span>
              <span className="hidden shrink-0 text-body-sm text-slate sm:inline">
                ур. {entry.level}
                {entry.cefrLevel && ` · ${entry.cefrLevel.toUpperCase()}`}
              </span>
              <span className="w-16 shrink-0 text-right text-body-sm text-ink">{entry.weeklyXp} XP</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
