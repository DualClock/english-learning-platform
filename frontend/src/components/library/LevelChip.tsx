'use client';

const STYLES: Record<string, string> = {
  A1: 'bg-[#E7ECE4] text-[#356B52]',
  A2: 'bg-[#E7ECE4] text-[#356B52]',
  B1: 'bg-[#F0E4D2] text-[#7A5C33]',
  B2: 'bg-[#F6EAC9] text-[#8A6D1F]',
  C1: 'bg-[#356B52] text-white',
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

  const style = STYLES[normalized] ?? 'bg-[#F7F5EF] text-[#5A5F5A] border border-[#D6D3CC]';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ${style} ${className}`}
    >
      {normalized}
    </span>
  );
}
