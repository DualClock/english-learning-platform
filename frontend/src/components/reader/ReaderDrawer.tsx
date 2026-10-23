'use client';

import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { ease, duration } from '@/lib/motion';

interface Props {
  onClose: () => void;
  children: ReactNode;
}

/**
 * Мобильная книжная полка: выезжает слева, как ящик каталожного шкафа.
 * Содержимое — тот же ReaderRail, что и на десктопе, поэтому состояния
 * оглавления, закладок и конспекта не расходятся.
 */
export default function ReaderDrawer({ onClose, children }: Props) {
  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-scrim"
        onClick={onClose}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: duration.fast, ease: ease.soft }}
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label="Оглавление и закладки"
        className="fixed left-0 top-0 z-50 h-[100dvh] w-[300px] max-w-[88vw] overflow-hidden shadow-modal"
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ duration: duration.base, ease: ease.soft }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        {children}
      </motion.aside>
    </>
  );
}
