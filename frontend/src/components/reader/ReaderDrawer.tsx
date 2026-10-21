'use client';

import { motion } from 'motion/react';
import { ease, duration } from '@/lib/motion';
import { CloseIcon } from '@/components/ui/icons';
import Button from '@/components/ui/Button';
import type { Bookmark, TocItem } from './types';

interface Props {
  tab: 'toc' | 'bookmarks';
  onTabChange: (tab: 'toc' | 'bookmarks') => void;
  onClose: () => void;
  tocItems: TocItem[];
  tocLoading: boolean;
  bookmarks: Bookmark[];
  onPage: (page: number) => void;
  onDeleteBookmark: (id: number) => void;
}

/* Отступ вложенности оглавления: шаг 8px, глубина 4 — дальше не размываем иерархию */
const indentClass = ['pl-2', 'pl-4', 'pl-6', 'pl-8'];
const indentOf = (level: number) => indentClass[Math.min(Math.max(level, 0), indentClass.length - 1)];

export default function ReaderDrawer({
  tab,
  onTabChange,
  onClose,
  tocItems,
  tocLoading,
  bookmarks,
  onPage,
  onDeleteBookmark,
}: Props) {
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
        className="fixed right-0 top-0 z-50 flex h-full w-80 max-w-[85vw] flex-col bg-canvas shadow-modal"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: duration.base, ease: ease.soft }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-3">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onTabChange('toc')}
              aria-current={tab === 'toc' ? 'true' : undefined}
              className={tab === 'toc' ? 'pill-tab-active' : 'pill-tab'}
            >
              Оглавление
            </button>
            <button
              type="button"
              onClick={() => onTabChange('bookmarks')}
              aria-current={tab === 'bookmarks' ? 'true' : undefined}
              className={tab === 'bookmarks' ? 'pill-tab-active' : 'pill-tab'}
            >
              Закладки <span className="tabular-nums">({bookmarks.length})</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded p-1 text-slate transition-colors duration-fast ease-soft hover:bg-surface hover:text-ink"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {tab === 'toc' ? (
            tocLoading ? (
              <p className="p-3 text-body-sm text-slate">Загружаем оглавление…</p>
            ) : tocItems.length === 0 ? (
              <p className="p-3 text-body-sm text-slate">
                В этой книге нет оглавления — листайте страницы стрелками или свайпом.
              </p>
            ) : (
              <ul>
                {tocItems.map((item, index) => (
                  <li key={`${item.page}-${index}`}>
                    <button
                      type="button"
                      onClick={() => {
                        onPage(item.page);
                        onClose();
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-md py-2 pr-2 text-left text-body-sm text-ink
                                  transition-colors duration-fast ease-soft hover:bg-surface ${indentOf(item.level)}`}
                    >
                      <span className="truncate">{item.title}</span>
                      <span className="shrink-0 text-caption tabular-nums text-slate">{item.page}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : bookmarks.length === 0 ? (
            <p className="p-3 text-body-sm text-slate">
              Пока нет закладок. Нажмите на флаг в шапке, чтобы отметить страницу.
            </p>
          ) : (
            <ul className="space-y-1">
              {bookmarks.map((bookmark) => (
                <li
                  key={bookmark.id}
                  className="flex items-center gap-2 rounded-md p-1 transition-colors duration-fast ease-soft hover:bg-surface"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onPage(bookmark.page);
                      onClose();
                    }}
                    className="min-w-0 flex-1 px-2 py-1.5 text-left text-body-sm text-ink"
                  >
                    Страница {bookmark.page}
                    {bookmark.note && (
                      <span className="mt-0.5 block truncate text-caption text-slate">{bookmark.note}</span>
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    aria-label={`Удалить закладку на странице ${bookmark.page}`}
                    onClick={() => onDeleteBookmark(bookmark.id)}
                    className="text-semantic-error hover:bg-surface-danger hover:text-ink"
                  >
                    <CloseIcon size={16} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.aside>
    </>
  );
}
