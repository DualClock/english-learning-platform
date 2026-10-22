'use client';

import type { ReactNode } from 'react';
import { openFeedback } from './events';

interface Props {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

/** Кнопка-триггер: сама открывает модалку и может закрыть drawer/меню. */
export default function FeedbackTrigger({ children, className = '', onClick }: Props) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onClick?.();
        openFeedback();
      }}
    >
      {children}
    </button>
  );
}
