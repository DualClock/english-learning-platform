import { type ReactNode } from 'react';

/**
 * Плашка уровня CEFR. Рампа идёт от нейтрального к бренду: чем выше уровень,
 * тем плотнее цвет. Тона берутся из токенов, поэтому рампа живёт в обеих темах.
 */
const LEVEL_TONE: Record<string, string> = {
  A1: 'bg-surface text-slate',
  A2: 'bg-surface-info text-on-info',
  B1: 'bg-surface-accent text-on-accent',
  B2: 'bg-surface-warning text-on-warning',
  C1: 'bg-surface-decor text-on-decor',
  C2: 'bg-primary text-on-primary',
};

export function normalizeLevel(level?: string | null): string {
  if (!level) return '';
  return level.trim().toUpperCase();
}

interface LevelChipProps {
  level?: string | null;
  /** Текст внутри плашки: по умолчанию сам уровень, но в сборниках это может быть «A1–B2» */
  children?: ReactNode;
  className?: string;
}

export default function LevelChip({ level, children, className = '' }: LevelChipProps) {
  const normalized = normalizeLevel(level);
  if (!normalized) return null;

  const tone = LEVEL_TONE[normalized] ?? 'bg-surface text-slate border border-hairline-strong';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-semibold leading-none ${tone} ${className}`.trim()}
    >
      {children ?? normalized}
    </span>
  );
}
