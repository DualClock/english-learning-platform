interface ProgressBarProps {
  value: number;
  /** Что измеряет полоса: без подписи скринридер озвучит только число */
  label?: string;
  className?: string;
}

export default function ProgressBar({ value, label, className = '' }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      className={`progress-bar ${className}`.trim()}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="progress-fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}
