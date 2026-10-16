'use client';

interface AlexAvatarProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animated?: boolean;
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-14 h-14',
  xl: 'w-28 h-28',
};

const faceSizes = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
  xl: 'w-16 h-16',
};

export default function AlexAvatar({ size = 'md', animated = false }: AlexAvatarProps) {
  const circle = (
    <div
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-pressed)] flex items-center justify-center shrink-0 ${
        animated ? 'assistant-glow' : ''
      }`}
    >
      <svg className={`${faceSizes[size]} text-[var(--color-tint-yellow-bold)]`} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        {/* глаза */}
        <circle cx="22" cy="26" r="3.2" fill="currentColor" />
        <circle cx="42" cy="26" r="3.2" fill="currentColor" />
        {/* улыбка */}
        <path
          d="M20 38c3.2 4.4 7.4 6.6 12 6.6s8.8-2.2 12-6.6"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );

  if (!animated) return circle;

  return (
    <div className="relative inline-flex items-center justify-center">
      <div className="absolute inset-0 rounded-full border-2 border-[var(--color-primary)] assistant-wave" />
      <div className="absolute inset-0 rounded-full border-2 border-[var(--color-primary)] assistant-wave" />
      <div className="assistant-float">{circle}</div>
    </div>
  );
}
