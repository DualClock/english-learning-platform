'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  CheckIcon,
  CloseIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/ui/icons';
import type { ReaderBookmark, ReaderManifest, ReaderPocketItem } from '@/lib/reader/types';

export type ReaderDrawerTab = 'toc' | 'bookmarks' | 'pocket';

interface Props {
  open: boolean;
  tab: ReaderDrawerTab;
  manifest: ReaderManifest;
  currentChapterId: string;
  bookmarks: ReaderBookmark[];
  pocketItems: ReaderPocketItem[];
  pocketLoading: boolean;
  progressPercent: number;
  onClose: () => void;
  onTabChange: (tab: ReaderDrawerTab) => void;
  onSelectChapter: (chapterId: string) => void;
  onSelectBookmark: (bookmark: ReaderBookmark) => void;
  onSelectPocket: (item: ReaderPocketItem) => void;
  onDeleteBookmark: (bookmarkId: number) => void;
  onPromotePocket: (pocketId: number) => void;
  onMarkKnown: (pocketId: number) => void;
  onDeletePocket: (pocketId: number) => void;
}

const TAB_LABELS: Record<ReaderDrawerTab, string> = {
  toc: 'Содержание',
  bookmarks: 'Закладки',
  pocket: 'Карман',
};

function chaptersLabel(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail >= 11 && tail <= 14) return 'глав';
  if (last === 1) return 'глава';
  if (last >= 2 && last <= 4) return 'главы';
  return 'глав';
}

export default function ReaderContentsDrawer({
  open,
  tab,
  manifest,
  currentChapterId,
  bookmarks,
  pocketItems,
  pocketLoading,
  progressPercent,
  onClose,
  onTabChange,
  onSelectChapter,
  onSelectBookmark,
  onSelectPocket,
  onDeleteBookmark,
  onPromotePocket,
  onMarkKnown,
  onDeletePocket,
}: Props) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="drawer-scrim"
            className="fixed inset-0 z-40 bg-scrim"
            variants={{
              hidden: { opacity: 0 },
              visible: { opacity: 1 },
              exit: { opacity: 0 },
            }}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            key="drawer-sheet"
            aria-label="Книжная полка"
            role="dialog"
            aria-modal="true"
            className="fixed inset-y-0 left-0 z-50 flex w-[min(88vw,360px)] flex-col text-[var(--color-on-dark)] shadow-modal"
            style={{ backgroundColor: 'var(--color-navy)' }}
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))]">
              <div className="min-w-0">
                <p className="text-caption uppercase tracking-[0.16em] text-[var(--color-on-dark-muted)]">Полка</p>
                <h2 className="mt-1 truncate font-heading text-body font-semibold">{manifest.book.title}</h2>
                <p className="mt-1 text-caption text-[var(--color-on-dark-muted)]">
                  {manifest.manifest.length} {chaptersLabel(manifest.manifest.length)} ·{' '}
                  {Math.round(progressPercent)}%
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть полку"
                className="rail-icon-btn"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div className="mx-5 flex rounded-lg bg-white/8 p-1">
              {(Object.keys(TAB_LABELS) as ReaderDrawerTab[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onTabChange(key)}
                  className={`flex-1 rounded-md px-1 py-2 text-caption transition-colors ${
                    tab === key
                      ? 'bg-white/14 text-white'
                      : 'text-[var(--color-on-dark-muted)] hover:text-[var(--color-on-dark)]'
                  }`}
                >
                  {TAB_LABELS[key]}
                  {key === 'pocket' && pocketItems.length > 0 ? ` · ${pocketItems.length}` : ''}
                </button>
              ))}
            </div>

            <div className="reader-scroll mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {tab === 'toc' ? (
                <div className="space-y-0.5">
                  {manifest.manifest.map((chapter) => {
                    const active = chapter.id === currentChapterId;
                    return (
                      <button
                        key={chapter.id}
                        type="button"
                        onClick={() => onSelectChapter(chapter.id)}
                        className={`flex w-full items-baseline gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                          active
                            ? 'bg-white/12 text-white'
                            : 'text-[var(--color-on-dark-muted)] hover:bg-white/8 hover:text-[var(--color-on-dark)]'
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate text-body-sm"
                            style={{ paddingLeft: `${Math.min(3, chapter.level) * 12}px` }}
                          >
                            {chapter.title}
                          </span>
                          <span className="mt-0.5 block text-caption opacity-70">
                            {chapter.wordCount.toLocaleString('ru-RU')} слов
                          </span>
                        </span>
                        {active ? <span className="text-caption text-[var(--color-tint-teal)]">сейчас</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : tab === 'bookmarks' ? (
                bookmarks.length === 0 ? (
                  <p className="px-3 py-8 text-center text-body-sm text-[var(--color-on-dark-muted)]">
                    Закладок пока нет. Нажмите на флажок в шапке — место сохранится.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {bookmarks.map((bookmark) => (
                      <div
                        key={bookmark.id}
                        className="rounded-lg bg-white/6 p-3 transition-colors hover:bg-white/10"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectBookmark(bookmark)}
                          className="block w-full text-left"
                        >
                          <span className="line-clamp-2 text-body-sm leading-relaxed text-[var(--color-on-dark)]">
                            {bookmark.excerpt || bookmark.note || 'Закладка в книге'}
                          </span>
                          {bookmark.note ? (
                            <span className="mt-1.5 block text-caption italic text-[var(--color-on-dark-muted)]">
                              {bookmark.note}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteBookmark(bookmark.id)}
                          aria-label="Удалить закладку"
                          className="rail-icon-btn h-8 w-8"
                        >
                          <TrashIcon size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : pocketLoading ? (
                <div className="space-y-2 px-2 py-3">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="h-20 animate-pulse rounded-lg bg-white/8" />
                  ))}
                </div>
              ) : pocketItems.length === 0 ? (
                <p className="px-3 py-8 text-center text-body-sm text-[var(--color-on-dark-muted)]">
                  Карман пуст. Откройте слово в тексте — оно тихо попадёт сюда.
                </p>
              ) : (
                <div className="space-y-2">
                  {pocketItems.map((item) => (
                    <div key={item.id} className="rounded-lg bg-white/6 p-3">
                      <button
                        type="button"
                        onClick={() => onSelectPocket(item)}
                        className="block w-full text-left"
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-reading text-body font-semibold text-[var(--color-on-dark)]">
                            {item.word}
                          </span>
                          <span className="truncate text-caption text-[var(--color-tint-teal)]">
                            {item.translationRu || 'перевод позже'}
                          </span>
                        </span>
                        {item.sentenceText ? (
                          <span className="mt-1 line-clamp-2 block text-caption leading-relaxed text-[var(--color-on-dark-muted)]">
                            {item.sentenceText}
                          </span>
                        ) : null}
                      </button>
                      <div className="mt-2 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onPromotePocket(item.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-caption text-[var(--color-on-dark)] hover:bg-white/16"
                        >
                          <PlusIcon size={16} /> Учить
                        </button>
                        <button
                          type="button"
                          onClick={() => onMarkKnown(item.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-caption text-[var(--color-on-dark)] hover:bg-white/16"
                        >
                          <CheckIcon size={16} /> Знаю
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeletePocket(item.id)}
                          aria-label={`Убрать ${item.word} из кармана`}
                          className="rail-icon-btn ml-auto h-8 w-8"
                        >
                          <TrashIcon size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
