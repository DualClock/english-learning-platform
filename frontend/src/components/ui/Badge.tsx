import type { ReactNode } from 'react';

type Tone = 'primary' | 'green' | 'orange' | 'purple' | 'sky' | 'navy' | 'secondary';

const pillClass: Record<Tone, string> = {
  primary: 'badge-primary',
  green: 'bg-[var(--color-success)] text-white',
  orange: 'bg-[var(--color-warning)] text-white',
  purple: 'bg-[#6D28D9] text-white',
  sky: 'bg-[#0B4A7A] text-white',
  navy: 'bg-navy text-white',
  secondary: 'badge-secondary',
};

const tagClass: Record<Tone, string> = {
  primary: 'badge-tag bg-[var(--color-tint-mint)] text-[#14662B]',
  green: 'badge-tag-green',
  orange: 'badge-tag-orange',
  purple: 'badge-tag-purple',
  sky: 'badge-tag-sky',
  navy: 'badge-tag bg-[var(--color-tint-sky)] text-[var(--color-navy)]',
  secondary: 'badge-tag bg-[var(--color-surface)] text-[var(--color-slate)]',
};

interface BadgeProps {
  tone?: Tone;
  tag?: boolean;
  className?: string;
  children: ReactNode;
}

export default function Badge({ tone = 'primary', tag = false, className = '', children }: BadgeProps) {
  const cls = `${tag ? tagClass[tone] : pillClass[tone]} ${className}`.trim();
  return <span className={cls}>{children}</span>;
}
