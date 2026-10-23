export type AvatarFrame = 'none' | 'paper' | 'teal' | 'ink' | 'gold';

export const AVATAR_FRAMES: {
  id: AvatarFrame;
  label: string;
  condition: string | null;
  achievement: string | null;
}[] = [
  { id: 'none', label: 'Без рамки', condition: null, achievement: null },
  {
    id: 'paper',
    label: 'Бумажная',
    condition: 'Откроется за «Первую книгу»',
    achievement: 'first_book',
  },
  {
    id: 'teal',
    label: 'Морская',
    condition: 'Откроется за «Первое повторение»',
    achievement: 'first_review',
  },
  {
    id: 'ink',
    label: 'Чернильная',
    condition: 'Откроется за стрик 7 дней',
    achievement: 'streak_7',
  },
  {
    id: 'gold',
    label: 'Золотая',
    condition: 'Откроется за 500 XP',
    achievement: 'xp_500',
  },
];

export function normalizeFrame(value?: string | null): AvatarFrame {
  return value === 'paper' || value === 'teal' || value === 'ink' || value === 'gold'
    ? value
    : 'none';
}

export function frameLabel(frame: AvatarFrame): string {
  return AVATAR_FRAMES.find((item) => item.id === frame)?.label ?? 'Без рамки';
}

/** Условие проверяется по реальным кодам достижений, а не по локальному флагу. */
export function frameUnlocked(frame: AvatarFrame, unlockedCodes: Set<string>): boolean {
  if (frame === 'none') return true;
  const def = AVATAR_FRAMES.find((item) => item.id === frame);
  return Boolean(def?.achievement && unlockedCodes.has(def.achievement));
}
