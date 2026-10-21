import type { ReactNode } from 'react';

type SolidTone = 'accent' | 'neutral' | 'inverse';
type TagTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'decor' | 'neutral';

const solidClass: Record<SolidTone, string> = {
  accent: 'badge-primary',
  neutral: 'badge-secondary',
  inverse: 'badge inline-flex items-center gap-1 rounded-full bg-surface-inverse px-2.5 py-1 text-caption font-semibold text-on-dark',
};

const tagClass: Record<TagTone, string> = {
  accent: 'badge-tag-teal',
  success: 'badge-tag-green',
  warning: 'badge-tag-orange',
  danger: 'badge-tag-red',
  info: 'badge-tag-sky',
  decor: 'badge-tag-purple',
  neutral: 'badge-tag bg-surface text-slate',
};

interface BadgeProps {
  tone?: SolidTone;
  className?: string;
  children: ReactNode;
}

/** Плотная плашка-статус: акцент, нейтральная или инверсная поверхность. */
export default function Badge({ tone = 'accent', className = '', children }: BadgeProps) {
  return <span className={`${solidClass[tone]} ${className}`.trim()}>{children}</span>;
}

interface TagProps {
  tone?: TagTone;
  className?: string;
  children: ReactNode;
}

/** Мягкое поле с подписью: цвет несёт смысл (успех, предупреждение, ошибка, информация). */
export function Tag({ tone = 'neutral', className = '', children }: TagProps) {
  return <span className={`${tagClass[tone]} ${className}`.trim()}>{children}</span>;
}
