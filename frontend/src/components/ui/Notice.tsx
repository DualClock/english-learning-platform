'use client';

import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, InfoIcon } from '@/components/ui/icons';

type Tone = 'success' | 'danger' | 'info';

const toneClass: Record<Tone, string> = {
  success: 'bg-surface-success text-on-success',
  danger: 'bg-surface-danger text-on-danger',
  info: 'bg-surface-info text-on-info',
};

/**
 * Строка ответа сервера под формой. Тон описывает смысл, а не цвет:
 * ошибка кричит role="alert", всё остальное — спокойный live-регион.
 */
export default function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? undefined : 'polite'}
      className={`flex items-start gap-2 rounded-md p-3 text-body-sm ${toneClass[tone]}`}
    >
      {tone === 'success' ? (
        <CheckIcon size={16} className="mt-0.5 shrink-0" />
      ) : tone === 'danger' ? (
        <AlertIcon size={16} className="mt-0.5 shrink-0" />
      ) : (
        <InfoIcon size={16} className="mt-0.5 shrink-0" />
      )}
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}
