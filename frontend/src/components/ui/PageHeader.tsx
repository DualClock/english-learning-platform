import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="page-header flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-h1 text-ink">{title}</h1>
        {subtitle && <p className="mt-2 max-w-measure text-body-sm text-slate">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
