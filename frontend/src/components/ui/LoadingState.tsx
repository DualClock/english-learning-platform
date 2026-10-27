import type { CSSProperties } from 'react';

export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-hairline-soft ${className}`.trim()}
      style={style}
      aria-hidden="true"
    />
  );
}

interface LoadingStateProps {
  /** Сколько строк-заглушек показать */
  rows?: number;
  /** Форма строк: список карточек или сетка обложек */
  shape?: 'rows' | 'grid';
  label?: string;
}

export default function LoadingState({ rows = 3, shape = 'rows', label = 'Загрузка' }: LoadingStateProps) {
  const items = Array.from({ length: rows }, (_, i) => i);
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="rounded-lg border border-hairline bg-canvas p-6">
      <span className="sr-only">{label}</span>
      {shape === 'rows' ? (
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i} className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 shrink-0" />
              <Skeleton className={`h-4 ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} />
              <Skeleton className="ml-auto h-4 w-16" />
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {items.map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-book w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
