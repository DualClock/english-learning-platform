'use client';

import { useApiQuery } from '@/app/lib/use-api';
import EmptyState from '@/components/ui/EmptyState';
import { Tag } from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { BulbIcon } from '@/components/ui/icons';
import {
  LEECH_THRESHOLD,
  RELIABLE_INTERVAL_DAYS,
  SRS_BUCKETS,
  distribution,
  percent,
  reliableCount,
  totalOf,
  wordsLabel,
  type SrsBucketId,
} from '@/lib/srs-buckets';

/** Ответ `GET /api/progress/srs-breakdown` (см. `SrsBreakdownDtos.cs`). */
interface SrsBreakdownResponse {
  totalWords?: number;
  learning?: number;
  short?: number;
  medium?: number;
  long?: number;
  leech?: number;
  reliableCount?: number;
  dueToday?: number;
  dueTomorrow?: number;
  reliableIntervalDays?: number;
}

/*
 * Цвет несёт смысл, а не украшение: от «учу» (светлое) к «почти выучено»
 * (плотный акцент). Словарь разложен по одному признаку — как далеко ушёл
 * интервал, — поэтому шкала монотонная, и глаз читает её как градусник.
 */
const BUCKET_CLASS: Record<SrsBucketId, string> = {
  learning: 'bg-surface-highlight',
  short: 'bg-surface-accent',
  medium: 'bg-primary',
  long: 'bg-primary-pressed',
};

const DUE_CACHE_KEY = '/api/progress/srs-breakdown';

export default function SrsBreakdownCard() {
  const { data, isLoading, error, refresh } = useApiQuery<SrsBreakdownResponse>(DUE_CACHE_KEY);

  const counts = data ?? null;
  const dist = distribution(counts);
  const total = totalOf(dist);
  const reliable = reliableCount(counts);
  const reliableThreshold = counts?.reliableIntervalDays ?? RELIABLE_INTERVAL_DAYS;
  const leech = counts?.leech ?? 0;
  const dueToday = counts?.dueToday ?? 0;
  const dueTomorrow = counts?.dueTomorrow ?? 0;

  return (
    <section className="card mb-6 scroll-mt-20 p-6" aria-label="Закрепление слов">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h3 text-ink">Как закреплены слова</h2>
        {counts && <span className="text-body-sm tabular-nums text-slate">{wordsLabel(total)}</span>}
      </div>

      {error && !counts ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-sm text-slate">Не удалось загрузить распределение повторений.</p>
          <Button variant="secondary" onClick={refresh} className="h-9 px-3 text-body-sm">
            Повторить
          </Button>
        </div>
      ) : isLoading && !counts ? (
        <p role="status" className="text-body-sm text-slate">
          Считаем распределение…
        </p>
      ) : total === 0 ? (
        <EmptyState
          variant="inline"
          className="border border-hairline"
          icon={<BulbIcon size={24} />}
          title="Пока нечего распределять"
          description="Как только в словаре появятся первые слова, здесь будет видно, как быстро они закрепляются."
        />
      ) : (
        <>
          {/* Полоса распределения: ширины — проценты, поэтому задаются инлайном. */}
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken"
            role="img"
            aria-label={SRS_BUCKETS.map(
              (bucket) => `${bucket.label}: ${wordsLabel(dist[bucket.id])}`
            ).join(', ')}
          >
            {SRS_BUCKETS.map((bucket) => {
              const share = percent(dist[bucket.id], total);
              if (share === 0) return null;
              return (
                <div
                  key={bucket.id}
                  className={`${BUCKET_CLASS[bucket.id]} h-full`}
                  style={{ width: `${share}%` }}
                  title={`${bucket.label} — ${wordsLabel(dist[bucket.id])}`}
                />
              );
            })}
          </div>

          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {SRS_BUCKETS.map((bucket) => (
              <li key={bucket.id} className="flex items-start gap-2">
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${BUCKET_CLASS[bucket.id]}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-body-sm font-semibold tabular-nums text-ink">
                    {dist[bucket.id]}
                    <span className="ml-1 font-normal text-slate">{bucket.label}</span>
                  </p>
                  <p className="text-caption leading-snug text-slate">{bucket.caption}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-hairline pt-4">
            <div className="flex items-baseline gap-2">
              <span className="text-h2 leading-none tabular-nums text-ink">{reliable}</span>
              {/* Пояснение порога — рядом с числом: 21 день без объяснения выглядит случайным. */}
              <span
                className="cursor-help border-b border-dotted border-hairline-strong text-body-sm text-slate"
                title={`Слово с интервалом больше ${reliableThreshold} дн. вернётся не раньше чем через три недели — значит оно держится в памяти без подсказок.`}
              >
                {wordsLabel(reliable)} знаю надёжно
              </span>
            </div>

            <p className="text-body-sm tabular-nums text-slate">
              сегодня <span className="font-semibold text-ink">{dueToday}</span>
              <span aria-hidden="true"> · </span>
              завтра <span className="font-semibold text-ink">{dueTomorrow}</span>
            </p>

            {leech > 0 && (
              <Tag tone="warning">
                {leech} {leech === 1 ? 'слово' : 'слов'} с {LEECH_THRESHOLD}+ срывами
              </Tag>
            )}
          </div>
        </>
      )}
    </section>
  );
}
