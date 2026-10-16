'use client';

const STYLES: Record<string, string> = {
  A1: 'bg-[var(--color-tint-mint)] text-[var(--color-primary)]',
  A2: 'bg-[var(--color-tint-mint)] text-[var(--color-primary)]',
  B1: 'bg-[#F0E4D2] text-[#7A5C33]',
  B2: 'bg-[#F6EAC9] text-[#7A3A00]',
  C1: 'bg-[var(--color-primary)] text-white',
};

export function normalizeLevel(level?: string | null): string {
  if (!level) return '';
  return level.trim().toUpperCase();
}

interface LevelChipProps {
  level?: string | null;
  className?: string;
}

export default function LevelChip({ level, className = '' }: LevelChipProps) {
  const normalized = normalizeLevel(level);
  if (!normalized) return null;

  const style = STYLES[normalized] ?? 'bg-[var(--color-surface)] text-[var(--color-slate)] border border-[var(--color-hairline-strong)]';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ${style} ${className}`}
    >
      {normalized}
    </span>
  );
}
