import type { ReactNode } from 'react';
import LexiMascot, { type LexiPose } from '../brand/lexi/LexiMascot';

interface EmptyStateProps {
  icon?: ReactNode;
  /** Поза Lexi вместо иконки: пустые состояния и ошибки говорят его голосом. */
  lexi?: LexiPose;
  title: string;
  description?: string;
  /** Слот действия: `<Button href=… />` или группа кнопок */
  action?: ReactNode;
  /** Поверхность внутри карточки-грида: компактный вариант для блока на экране */
  variant?: 'page' | 'inline';
  className?: string;
}

export default function EmptyState({
  icon,
  lexi,
  title,
  description,
  action,
  variant = 'page',
  className = '',
}: EmptyStateProps) {
  const box = variant === 'page' ? 'rounded-lg border border-hairline bg-canvas p-8' : 'bg-canvas p-6';
  return (
    <div className={`${box} text-center ${className}`.trim()}>
      {lexi ? (
        <LexiMascot pose={lexi} className="mx-auto mb-4 w-24" />
      ) : (
        icon && (
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-surface text-slate">
            {icon}
          </div>
        )
      )}
      <h2 className="text-h3 text-ink">{title}</h2>
      {description && (
        <p className="mx-auto mt-2 max-w-measure-sm text-body-sm text-slate">{description}</p>
      )}
      {action && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  );
}
