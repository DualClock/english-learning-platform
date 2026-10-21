'use client';

import { useEffect } from 'react';

interface UseReaderShortcutsOptions {
  currentPage: number;
  onPage: (page: number) => void;
  /** Открыт слой, который забирает стрелки: меню текста, конспект, диалог, туториал */
  blocked: boolean;
  onEscape: () => void;
}

/** ←/→ листают страницы, Escape закрывает меню и карточку слова. */
export function useReaderShortcuts({
  currentPage,
  onPage,
  blocked,
  onEscape,
}: UseReaderShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === 'Escape') {
        onEscape();
        return;
      }

      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        blocked
      ) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onPage(currentPage - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onPage(currentPage + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [blocked, currentPage, onEscape, onPage]);
}
