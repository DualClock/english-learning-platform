'use client';

import { useApiQuery } from '@/app/lib/use-api';
import { pluralQuestions, pluralWords } from '@/lib/plural';
import { formatNumber } from '@/lib/format';
import Button from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/LoadingState';
import { TargetIcon } from '@/components/ui/icons';

interface CheckpointPreview {
  level: string;
  matchedWords: number;
  dictionaryWords: number;
  requiredWords: number;
  available: boolean;
  questionCapacity: number;
}

const LEVEL_TITLES: Record<string, string> = {
  a1: 'A1',
  a2: 'A2',
  b1: 'B1',
  b2: 'B2',
};

/**
 * Карточка чекпоинт-теста на дашборде. Запрашивает только счётчики
 * (preview=true), поэтому не генерирует колоду вопросов при каждой загрузке.
 */
export default function CheckpointCard({ level }: { level?: string | null }) {
  const target = (level ?? 'b1').toLowerCase();
  const label = LEVEL_TITLES[target] ?? target.toUpperCase();

  const { data } = useApiQuery<CheckpointPreview>(
    `/api/practice/checkpoint?level=${encodeURIComponent(target)}&preview=true`
  );

  if (!data) {
    return (
      <section className="card mb-8" aria-busy="true">
        <div className="flex items-center gap-5">
          <Skeleton className="h-14 w-14 rounded-lg" />
          <div className="min-w-0 grow space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-10 w-40" />
          </div>
        </div>
      </section>
    );
  }

  const matched = data.matchedWords;
  const capacity = data.questionCapacity;

  return (
    <section className="card mb-8" aria-label={`Чекпоинт ${label}`}>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-accent text-primary">
          <span className="text-caption text-slate">ур.</span>
          <span className="text-h3 leading-none">{label}</span>
        </div>

        <div className="min-w-0 grow basis-56">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-h3 text-ink">Чекпоинт {label}</h2>
            <span className="text-caption text-slate tabular-nums">
              {formatNumber(matched)} {pluralWords(matched)} уровня {label} в словаре
            </span>
          </div>

          <p className="mb-5 max-w-measure text-body-sm text-charcoal">
            {data.available
              ? `Тест на ${formatNumber(capacity)} ${pluralQuestions(capacity)}: проверьте, готовы ли вы к уровню ${label}.`
              : `Нужно минимум ${formatNumber(data.requiredWords)} ${pluralWords(
                  data.requiredWords
                )} в словаре — сейчас ${formatNumber(data.dictionaryWords)}. Добавьте слова из книги или сборника.`}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            {data.available ? (
              <Button
                href={`/quiz?checkpoint=${encodeURIComponent(target)}`}
                className="text-caption"
              >
                <TargetIcon size={16} />
                Пройти чекпоинт
              </Button>
            ) : (
              <Button href="/dictionary?tab=lists" variant="secondary" className="text-caption">
                Пополнить словарь
              </Button>
            )}
            {data.available && matched < capacity && (
              <span className="text-caption text-slate">
                Часть вопросов будет из других уровней — слов {label} пока мало.
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
