'use client';

import { AnimatePresence, motion } from 'motion/react';
import { variants } from '@/lib/motion';
import { CloseIcon, NotebookIcon } from '@/components/ui/icons';
import { Tag } from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import type { CollectedWord } from './types';

interface Props {
  items: CollectedWord[];
  isFinishing: boolean;
  onRemove: (word: string) => void;
  onFinish: () => void;
}

/** Конспект страницы: собранные слова-маркеры и завершение чтения. */
export default function NotesPopover({ items, isFinishing, onRemove, onFinish }: Props) {
  return (
    <motion.div
      variants={variants.overlay}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="card fixed inset-x-4 top-20 z-40 flex max-h-[70vh] flex-col p-4 shadow-modal sm:absolute sm:inset-x-auto sm:right-8 sm:top-32 sm:w-80"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-body-sm font-semibold text-ink">
          <NotebookIcon size={16} />
          Конспект
          <Tag tone="neutral" className="tabular-nums">
            {items.length}
          </Tag>
        </h3>
      </div>

      <div className="mb-3 flex-1 space-y-2 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-1 py-4 text-body-sm text-slate">
            Пока пусто. Нажимайте на слова-маркеры в тексте — они соберутся сюда,
            а в конце главы станут мини-тестом.
          </p>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.li
                  key={item.text}
                  variants={variants.item}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  layout
                  className="flex items-start justify-between gap-2 rounded-md border border-hairline bg-surface p-2"
                >
                  <div className="min-w-0">
                    <p className="break-words text-body-sm font-medium text-ink">{item.text}</p>
                    {item.sentence && (
                      <p className="mt-0.5 line-clamp-2 break-words text-caption text-slate">{item.sentence}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(item.text)}
                    aria-label={`Убрать ${item.text} из конспекта`}
                    className="shrink-0 rounded p-1 text-slate transition-colors duration-fast ease-soft hover:bg-surface-danger hover:text-ink"
                  >
                    <CloseIcon size={16} />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <Button onClick={onFinish} disabled={isFinishing} className="w-full">
        {isFinishing ? 'Завершаем…' : 'Завершить чтение'}
      </Button>
    </motion.div>
  );
}
