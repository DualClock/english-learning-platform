import { formatNumber } from '@/lib/format';
import type { XpRule } from './leagueTypes';

/**
 * Таблица начислений приходит из API, чтобы интерфейс не обещал другие цифры.
 * На мобильном это список, а не широкая таблица: источник и лимит читаются рядом.
 */
export default function XpRulesTable({ rules }: { rules: XpRule[] }) {
  if (rules.length === 0) {
    return <p className="text-caption text-slate">Правила XP скоро появятся.</p>;
  }

  return (
    <div>
      <ul className="divide-y divide-hairline">
        {rules.map((rule) => (
          <li key={rule.code} className="flex items-start justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-ink">{rule.title}</p>
              <p className="mt-0.5 text-caption leading-snug text-slate">{rule.note}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-body-sm tabular-nums text-ink">
                {formatNumber(rule.xp)} XP / {rule.unit}
              </p>
              {rule.dailyCapXp != null && rule.code !== 'daily_goal' && (
                <p className="mt-0.5 text-caption tabular-nums text-slate">
                  до {formatNumber(rule.dailyCapXp)} XP в день
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-caption leading-relaxed text-slate">
        Множителя за стрик нет: стрик ведёт к достижениям, но не увеличивает XP.
      </p>
    </div>
  );
}
