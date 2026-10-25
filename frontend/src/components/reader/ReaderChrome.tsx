'use client';

import Link from 'next/link';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkFilledIcon,
  BookmarkIcon,
  HeadphonesIcon,
  MenuIcon,
  SlidersIcon,
} from '@/components/ui/icons';

interface Props {
  visible: boolean;
  chapterTitle: string;
  page: number;
  totalPages: number;
  bookPercent: number;
  hasBookmark: boolean;
  pocketCount: number;
  isListening: boolean;
  onToggleBookmark: () => void;
  onOpenDrawer: () => void;
  onOpenSettings: () => void;
  onListen: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

const ICON_CLASS = 'reader-icon-btn';

export default function ReaderChrome({
  visible,
  chapterTitle,
  page,
  totalPages,
  bookPercent,
  hasBookmark,
  pocketCount,
  isListening,
  onToggleBookmark,
  onOpenDrawer,
  onOpenSettings,
  onListen,
  onPrevious,
  onNext,
}: Props) {
  const Bookmark = hasBookmark ? BookmarkFilledIcon : BookmarkIcon;

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-30 transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden={!visible}
    >
      <header
        className={`pointer-events-auto absolute inset-x-0 top-0 border-b border-[var(--reader-hairline)] bg-[var(--reader-paper)] ${
          visible ? '' : 'pointer-events-none'
        }`}
      >
        <div className="mx-auto flex h-12 max-w-[780px] items-center gap-1 px-2 sm:px-4">
          <Link
            href="/books"
            aria-label="Вернуться к книгам"
            title="К книгам"
            className={ICON_CLASS}
          >
            <ArrowLeftIcon size={20} />
          </Link>

          <div className="min-w-0 flex-1 px-1">
            <p className="truncate font-reading text-body-sm text-[var(--reader-ink)]">{chapterTitle}</p>
          </div>

          <button
            type="button"
            onClick={onToggleBookmark}
            aria-label={hasBookmark ? 'Убрать закладку' : 'Поставить закладку'}
            title={hasBookmark ? 'Убрать закладку' : 'Поставить закладку'}
            aria-pressed={hasBookmark}
            className={ICON_CLASS}
          >
            <Bookmark size={20} />
          </button>

          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label={`Карман и содержание${pocketCount > 0 ? `, слов: ${pocketCount}` : ''}`}
            title="Содержание и карман"
            className={ICON_CLASS}
          >
            <MenuIcon size={20} />
          </button>

          <button
            type="button"
            onClick={onListen}
            aria-label={isListening ? 'Озвучка главы включена' : 'Слушать главу'}
            title={isListening ? 'Озвучка главы включена' : 'Слушать главу'}
            aria-pressed={isListening}
            data-active={isListening ? 'true' : undefined}
            className={ICON_CLASS}
          >
            <HeadphonesIcon size={20} />
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Настройки чтения"
            title="Настройки чтения"
            className={ICON_CLASS}
          >
            <SlidersIcon size={20} />
          </button>
        </div>
      </header>

      <footer
        className={`pointer-events-auto absolute inset-x-0 bottom-0 border-t border-[var(--reader-hairline)] bg-[var(--reader-paper)] ${
          visible ? '' : 'pointer-events-none'
        }`}
      >
        <div className="mx-auto flex h-11 max-w-[780px] items-center gap-2 px-2 sm:px-4">
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onPrevious}
              disabled={page <= 1}
              aria-label="Предыдущая страница"
              className={`${ICON_CLASS} h-9 w-9`}
            >
              <ArrowLeftIcon size={20} />
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label={page >= totalPages ? 'Глава прочитана — разобрать' : 'Следующая страница'}
              title={page >= totalPages ? 'Глава прочитана — разобрать' : 'Следующая страница'}
              className={`${ICON_CLASS} h-9 w-9`}
            >
              <ArrowRightIcon size={20} />
            </button>
          </div>

          <span className="shrink-0 text-caption tabular-nums text-[var(--reader-ink-soft)]" aria-live="polite">
            {page} / {totalPages}
          </span>

          <span
            className="min-w-0 flex-1 truncate text-center font-reading text-caption text-[var(--reader-ink-soft)]"
            title={chapterTitle}
          >
            {chapterTitle}
          </span>

          <div className="hidden h-1 w-24 shrink-0 overflow-hidden rounded-full bg-[var(--reader-hairline)] sm:block">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.min(100, Math.max(0, bookPercent))}%` }}
            />
          </div>
        </div>
      </footer>
    </div>
  );
}
