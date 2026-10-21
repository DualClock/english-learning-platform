'use client';

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
    <div className="card fixed inset-x-4 top-20 z-40 flex max-h-[70vh] flex-col p-4 shadow-xl sm:absolute sm:inset-x-auto sm:right-8 sm:top-32 sm:w-80">
      <h3 className="font-semibold text-[var(--color-ink)] mb-3">Конспект ✦ {items.length}</h3>
      <div className="overflow-y-auto space-y-2 mb-3 flex-1">
        {items.length === 0 ? (
          <p className="text-sm text-[var(--color-slate)]">
            Нажимайте на маркерные слова (✦), чтобы собрать их в конспект.
          </p>
        ) : (
          items.map((item) => (
            <div
              key={item.text}
              className="p-2 bg-[var(--color-surface)] rounded-lg border border-[var(--color-hairline-strong)] flex items-start justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink)] break-words">{item.text}</p>
                {item.sentence && (
                  <p className="text-xs text-[var(--color-slate)] mt-0.5 line-clamp-2 break-words">{item.sentence}</p>
                )}
              </div>
              <button
                onClick={() => onRemove(item.text)}
                className="text-[var(--color-error)] hover:text-[#8F4343] text-lg leading-none shrink-0"
                title="Удалить"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
      <button
        onClick={onFinish}
        disabled={isFinishing}
        className="w-full btn-primary disabled:opacity-50"
      >
        {isFinishing ? 'Завершаем…' : 'Завершить чтение'}
      </button>
    </div>
  );
}
