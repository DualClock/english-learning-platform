import Link from 'next/link';
import type { ReactNode } from 'react';

type FieldTone = 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'decor' | 'highlight';

const fieldClass: Record<FieldTone, string> = {
  info: 'bg-surface-info text-ink',
  success: 'bg-surface-success text-ink',
  warning: 'bg-surface-warning text-ink',
  danger: 'bg-surface-danger text-ink',
  accent: 'bg-surface-accent text-ink',
  decor: 'bg-surface-decor text-ink',
  highlight: 'bg-surface-highlight text-ink',
};

interface CardProps {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'article' | 'li';
}

/** Плоская поверхность карточки: hairline + шаг тона, без тени в покое. */
export default function Card({ className = '', children, as = 'div' }: CardProps) {
  const Box = as;
  return <Box className={`card ${className}`.trim()}>{children}</Box>;
}

interface CardInteractiveProps {
  className?: string;
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
}

/** Карточка, по которой можно нажать: настоящая ссылка или кнопка, с подъёмом на hover. */
export function CardInteractive({ className = '', children, href, onClick, ariaLabel }: CardInteractiveProps) {
  const cls = `card-interactive w-full text-left ${className}`.trim();
  if (href) {
    return (
      <Link href={href} className={cls} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} aria-label={ariaLabel}>
      {children}
    </button>
  );
}

interface CardFieldProps {
  tone: FieldTone;
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'article' | 'li';
}

/** Карточка-поле: цвет объясняет роль блока (успех, предупреждение, подсказка). */
export function CardField({ tone, className = '', children, as = 'div' }: CardFieldProps) {
  const Box = as;
  return <Box className={`rounded-lg p-6 ${fieldClass[tone]} ${className}`.trim()}>{children}</Box>;
}
