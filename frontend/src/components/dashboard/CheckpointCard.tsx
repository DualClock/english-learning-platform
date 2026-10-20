'use client';

import Link from 'next/link';
import { useApiQuery } from '@/app/lib/use-api';

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
    return <div className="card p-5 mb-8 h-28 animate-pulse bg-white" />;
  }

  const matched = data.matchedWords;
  const capacity = data.questionCapacity;

  return (
    <section className="card p-5 mb-8" aria-label={`Чекпоинт ${label}`}>
      <div className="flex flex-wrap items-start gap-5">
        <div className="w-14 h-14 shrink-0 rounded-2xl bg-[var(--color-tint-mint)] flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-slate)]">ур.</span>
          <span className="text-base font-bold text-[var(--color-primary)] leading-none">{label}</span>
        </div>

        <div className="flex-1 min-w-[220px]">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h2 className="text-base font-semibold text-[var(--color-ink)]">Чекпоинт {label}</h2>
            <span className="text-xs text-[var(--color-slate)]">
              {matched} {plural(matched, 'слово', 'слова', 'слов')} уровня {label} в словаре
            </span>
          </div>

          <p className="text-sm text-[var(--color-slate)] mb-3">
            {data.available
              ? `Тест на ${capacity} ${plural(capacity, 'вопрос', 'вопроса', 'вопросов')}: проверьте, готовы ли вы к уровню ${label}.`
              : `Нужно минимум ${data.requiredWords} слова в словаре — сейчас ${data.dictionaryWords}. Добавьте слова из книги или сборника.`}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            {data.available ? (
              <Link href={`/quiz?checkpoint=${encodeURIComponent(target)}`} className="btn-primary text-sm">
                Пройти чекпоинт
              </Link>
            ) : (
              <Link href="/dictionary?tab=lists" className="btn-secondary text-sm">
                Пополнить словарь
              </Link>
            )}
            {data.available && matched < capacity && (
              <span className="text-xs text-[var(--color-slate)]">
                Часть вопросов будет из других уровней — слов {label} пока мало.
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
