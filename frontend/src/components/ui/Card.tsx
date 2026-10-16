import type { ReactNode } from 'react';

type Tint = 'peach' | 'rose' | 'mint' | 'lavender' | 'sky' | 'yellow' | 'yellow-bold';

interface CardProps {
  tint?: Tint;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}

export default function Card({ tint, interactive = false, className = '', children, onClick }: CardProps) {
  const base = tint ? `card-tint-${tint}` : interactive ? 'card-interactive' : 'card';
  const cls = `${base} ${className}`.trim();
  if (onClick) {
    return (
      <div className={cls} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
        {children}
      </div>
    );
  }
  return <div className={cls}>{children}</div>;
}
