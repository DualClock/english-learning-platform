'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useApiQuery } from '@/app/lib/use-api';
import { plural } from '@/lib/plural';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import Button from '@/components/ui/Button';
import { Tag } from '@/components/ui/Badge';
import {
  ClockIcon,
  CloseIcon,
  GemIcon,
  MedalIcon,
  SparkIcon,
  StarIcon,
  TrophyIcon,
  type IconProps,
  type IconSize,
} from '@/components/ui/icons';
import XpRulesTable from './XpRulesTable';
import { MIN_COMPETITIVE_PARTICIPANTS, shouldRenderLeague } from '@/components/dashboard/dashboard-state';
import type { Leaderboard, LeagueHistoryItem } from './leagueTypes';

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

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Закрываем неделю…';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes % 60} мин`;
  return `${Math.max(1, minutes)} мин`;
}

function outcomeMeta(outcome: LeagueHistoryItem['outcome']): {
  label: string;
  tone: 'success' | 'danger' | 'neutral';
} {
  switch (outcome) {
    case 'promoted':
      return { label: 'Повышение', tone: 'success' };
    case 'demoted':
      return { label: 'Вылет', tone: 'danger' };
    case 'forming':
      return { label: 'Формировалась', tone: 'neutral' };
    default:
      return { label: 'Остались', tone: 'neutral' };
  }
}

function zoneDotClass(zone: string): string {
  if (zone === 'promotion') return 'bg-primary';
  if (zone === 'demotion') return 'bg-semantic-error';
  return 'bg-hairline-strong';
}

/**
 * Лига недели v2: реальная группа до 30 участников, зоны повышения и вылета,
 * таймер до закрытия, история переходов и правила XP.
 */
export default function WeeklyLeague() {
  const { data, isLoading, refresh } = useApiQuery<Leaderboard>('/api/progress/leaderboard');
  const [now, setNow] = useState<number | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const closeRulesRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!rulesOpen) return;
    closeRulesRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRulesOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [rulesOpen]);

  const endsAt = data ? new Date(data.weekEndsAt).getTime() : null;
  const msLeft = endsAt != null && now != null ? endsAt - now : null;

  // После дедлайна перечитываем лигу: сервер лениво закроет неделю и вернёт новую.
  useEffect(() => {
    if (msLeft == null || msLeft > 0) return;
    const timer = setTimeout(refresh, 2500);
    return () => clearTimeout(timer);
  }, [msLeft, refresh]);

  if (isLoading && !data) {
    return (
      <section className="card mb-6 scroll-mt-20 p-6" aria-label="Лига недели">
        <LoadingState rows={4} label="Загрузка лиги недели" />
      </section>
    );
  }

  // Блок факультативный: без лидерборда экран прогресса остаётся полезным.
  if (!data) return null;

  const { group, me, entries, history, leagues } = data;

  /*
   * Пока в группе меньше порога — соревнования нет, и показывать «Лига
   * формируется: 3 участника» вредно: человек читает это как подтверждение,
   * что здесь никого нет, и уходит. Вместо пустой лиги — личная цель недели:
   * с кем соревноваться, когда вокруг никого, — с собой на прошлой неделе.
   */
  if (!shouldRenderLeague(group.participants)) {
    const previousWeek = history[0] ?? null;
    const delta = previousWeek ? me.weeklyXp - previousWeek.weeklyXp : null;
    return (
      <section className="card mb-6 scroll-mt-20 p-6" aria-label="Цель недели">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-h3 text-ink">Цель недели</h2>
          <span className="text-body-sm text-slate tabular-nums">
            {me.weeklyXp} XP
            {previousWeek && ` · было ${previousWeek.weeklyXp} XP`}
          </span>
        </div>
        <p className="text-body-sm text-slate">
          {delta === null
            ? 'Это ваша первая неделя — ориентир появится со следующей недели.'
            : delta >= 0
              ? `Вы уже на ${delta} XP выше прошлой недели. Держите темп.`
              : `До прошлой недели осталось ${Math.abs(delta)} XP.`}
        </p>
        <p className="mt-2 text-caption text-slate">
          Соревнование с другими откроется, когда в группе соберётся
          {' '}
          {MIN_COMPETITIVE_PARTICIPANTS} участников.
        </p>
      </section>
    );
  }

  const myZoneText = (() => {
    if (group.forming) {
      return `Лига формируется: ${group.participants} ${plural(group.participants, ['участник', 'участника', 'участников'])}. Повышение и вылет включим с 10 реальных участников.`;
    }
    if (me.zone === 'promotion') {
      return group.promotionLeagueTitle
        ? `Вы в зоне повышения до «${group.promotionLeagueTitle}».`
        : 'Вы в верхней зоне — выше уже некуда.';
    }
    if (me.zone === 'demotion') {
      return group.demotionLeagueTitle
        ? `Вы в зоне вылета — в «${group.demotionLeagueTitle}».`
        : 'Вы в нижней зоне — ниже уже некуда.';
    }
    if (me.rank == null) return 'На этой неделе XP пока нет — сделайте первый шаг.';
    return 'Держитесь в середине: топ-5 повышаются, нижние 5 вылетают.';
  })();

  return (
    <section className="card mb-6 scroll-mt-20 p-6" aria-label="Лига недели">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h3 text-ink">Лига недели</h2>
        <div className="flex flex-wrap items-center gap-3 text-body-sm text-slate">
          <span>
            {formatRange(data.weekStart, data.weekEnd)} · {group.participants}{' '}
            {plural(group.participants, ['участник', 'участника', 'участников'])}
          </span>
          {msLeft != null && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-caption">
              <ClockIcon size={16} />
              {formatCountdown(msLeft)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            className="text-body-sm font-medium text-primary hover:underline"
          >
            Правила
          </button>
        </div>
      </div>

      {/* Своя позиция и лига */}
      <div className="mb-5 rounded-xl bg-surface-accent p-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-canvas text-on-accent">
            <LeagueIcon league={group.league} size={24} />
          </span>
          <div className="min-w-52 flex-1">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-semibold text-ink">
                {group.leagueTitle}
                {group.index > 1 && <span className="ml-2 text-body-sm font-normal text-slate">группа {group.index}</span>}
                {me.rank != null && (
                  <span className="ml-2 text-body-sm font-normal text-slate">
                    № {me.rank} из {group.participants}
                  </span>
                )}
              </p>
              <p className="text-body-sm text-slate">
                <strong className="text-ink">{me.weeklyXp}</strong> XP за неделю
              </p>
            </div>

            <p className="text-caption leading-relaxed text-slate">{myZoneText}</p>

            {!group.forming && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-slate">
                {group.promotionAvailable && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                    топ-{group.promotionSpots} — повышение
                  </span>
                )}
                {group.demotionAvailable && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-semantic-error" aria-hidden="true" />
                    нижние {group.demotionSpots} — вылет
                  </span>
                )}
                <span>в группе до {group.sizeLimit}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          variant="inline"
          className="border border-hairline"
          icon={<TrophyIcon size={24} />}
          title="Группа ещё не собралась"
          description="На этой неделе в вашей лиге пока нет XP. Сделайте первый шаг — и появится рейтинг."
          action={
            <Button href="/review" variant="secondary">
              К повторению
            </Button>
          }
        />
      ) : (
        <ol className="stagger divide-y divide-hairline">
          {entries.map((entry) => (
            <li
              key={`${entry.rank}-${entry.name}`}
              className={`flex items-center gap-3 py-2.5 ${entry.isMe ? 'bg-surface font-semibold' : ''}`}
            >
              <span
                className={`w-7 shrink-0 text-center text-body-sm ${
                  entry.zone === 'promotion'
                    ? 'text-primary'
                    : entry.zone === 'demotion'
                      ? 'text-semantic-error'
                      : 'text-slate'
                }`}
              >
                {entry.rank}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">
                {entry.name}
                {entry.isMe && <span className="ml-2 text-caption font-normal text-primary">это вы</span>}
              </span>
              <span className="hidden shrink-0 text-body-sm text-slate sm:inline">
                ур. {entry.level}
                {entry.cefrLevel && ` · ${entry.cefrLevel.toUpperCase()}`}
              </span>
              <span className="w-16 shrink-0 text-right text-body-sm text-ink">{entry.weeklyXp} XP</span>
              {!group.forming && (
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${zoneDotClass(entry.zone)}`}
                  title={
                    entry.zone === 'promotion'
                      ? 'Зона повышения'
                      : entry.zone === 'demotion'
                        ? 'Зона вылета'
                        : 'Середина группы'
                  }
                />
              )}
            </li>
          ))}
        </ol>
      )}

      <details className="mt-5 rounded-lg border border-hairline">
        <summary className="cursor-pointer px-4 py-3 text-body-sm font-medium text-ink">
          История лиги
          {history[0] && (
            <span className="ml-2 font-normal text-slate">
              · прошлая неделя: {history[0].leagueTitle}, {history[0].rank} из {history[0].participants}
            </span>
          )}
        </summary>
        <div className="border-t border-hairline px-4 py-3">
          {history.length === 0 ? (
            <p className="text-caption leading-relaxed text-slate">
              История появится после первой закрытой недели. Неделя закрывается в понедельник 00:00 UTC.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {history.map((item) => {
                const meta = outcomeMeta(item.outcome);
                return (
                  <li
                    key={`${item.weekStart}-${item.league}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-body-sm"
                  >
                    <span className="inline-flex items-center gap-1.5 text-ink">
                      <LeagueIcon league={item.league} size={16} />
                      {item.leagueTitle}
                    </span>
                    {(item.outcome === 'promoted' || item.outcome === 'demoted') &&
                      item.nextLeagueTitle !== item.leagueTitle && (
                        <span className="text-caption text-slate">→ {item.nextLeagueTitle}</span>
                      )}
                    <span className="text-caption text-slate">{formatRange(item.weekStart, item.weekEnd)}</span>
                    <span className="text-caption text-slate">
                      {item.rank} из {item.participants} · {item.weeklyXp} XP
                    </span>
                    <span className="ml-auto">
                      <Tag tone={meta.tone}>{meta.label}</Tag>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>

      <AnimatePresence>
        {rulesOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-4 sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setRulesOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="league-rules-title"
              className="card relative max-h-[90dvh] w-full max-w-lg overflow-y-auto p-6"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                ref={closeRulesRef}
                type="button"
                onClick={() => setRulesOpen(false)}
                aria-label="Закрыть правила лиги"
                className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded text-slate transition-colors duration-fast ease-soft hover:bg-surface hover:text-ink"
              >
                <CloseIcon size={20} />
              </button>

              <h2 id="league-rules-title" className="pr-10 text-h2 text-ink">
                Правила лиги
              </h2>

              <div className="mt-4 space-y-3 text-body-sm leading-relaxed text-slate">
                <p>Пять ступеней: Бронза, Серебро, Золото, Платина и Алмаз.</p>
                <p>Неделя идёт с понедельника по воскресенье. Внутри лиги — группы до 30 реальных участников.</p>
                <p>
                  Если в группе от 10 человек, топ-5 повышаются, а нижние 5 вылетают.
                  В бронзе вылета нет, из алмаза выше некуда.
                </p>
                <p>
                  Пока участников меньше 10, лига формируется: без ботов и выдуманных имён.
                  История и переходы появятся после первой закрытой недели.
                </p>
              </div>

              <div className="mt-5">
                <h3 className="text-h3 text-ink">За что дают XP</h3>
                <p className="mt-1 text-caption text-slate">
                  Цифры приходят из тех же правил, что начисляют XP в приложении.
                </p>
                <div className="mt-3">
                  <XpRulesTable rules={data.xpRules} />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {leagues.map((league) => (
                  <span
                    key={league.code}
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-caption text-slate"
                  >
                    <LeagueIcon league={league.code} size={16} />
                    {league.title}
                  </span>
                ))}
              </div>

              <Button variant="secondary" onClick={() => setRulesOpen(false)} className="mt-6 h-11 w-full">
                Понятно
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
