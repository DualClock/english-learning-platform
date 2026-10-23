'use client';

import type { ComponentType } from 'react';
import { BookmarkFilledIcon, BookmarkIcon, ChevronRightIcon, MenuIcon, NotebookIcon } from '@/components/ui/icons';
import type { IconProps } from '@/components/ui/icons';
import TextSettingsMenu from './TextSettingsMenu';

interface Props {
  bookTitle: string;
  chapterTitle: string;
  hasBookmark: boolean;
  parallelMode: boolean;
  panelOpen: boolean;
  notesVisible: boolean;
  notesCount: number;
  canCollect: boolean;
  railOpen: boolean;
  textSettings: {
    open: boolean;
    onToggle: () => void;
    fontSize: number;
    lineWidth: number;
    onFontSizeChange: (delta: number) => void;
    onLineWidthChange: (value: number) => void;
    onReset: () => void;
  };
  onOpenDrawer: () => void;
  onToggleRail: () => void;
  onToggleBookmark: () => void;
  onToggleParallel: () => void;
  onTogglePanel: () => void;
  onToggleNotes: () => void;
}

/**
 * Верхняя панель читальни: глава слева, инструменты справа. На телефоне
 * остаются только полка, закладка, кегль и RU — остальное живёт в полке,
 * чтобы текст начинался выше и дышал.
 */
export default function ReaderToolbar({
  bookTitle,
  chapterTitle,
  hasBookmark,
  parallelMode,
  panelOpen,
  notesVisible,
  notesCount,
  canCollect,
  railOpen,
  textSettings,
  onOpenDrawer,
  onToggleRail,
  onToggleBookmark,
  onToggleParallel,
  onTogglePanel,
  onToggleNotes,
}: Props) {
  const BookmarkIconType: ComponentType<IconProps> = hasBookmark ? BookmarkFilledIcon : BookmarkIcon;

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--reader-hairline)] bg-[var(--reader-paper)] px-2 sm:px-4">
      <button
        type="button"
        onClick={onOpenDrawer}
        title="Оглавление и заметки"
        aria-label="Оглавление"
        className="reader-icon-btn lg:hidden"
      >
        <MenuIcon size={20} />
      </button>

      <button
        type="button"
        onClick={onToggleRail}
        title={railOpen ? 'Скрыть книжную полку' : 'Показать книжную полку'}
        aria-label="Оглавление"
        aria-expanded={railOpen}
        className="reader-icon-btn hidden lg:inline-flex"
      >
        <MenuIcon size={20} />
      </button>

      <div className="min-w-0 flex-1 px-1">
        <p className="truncate font-heading text-body-sm font-medium text-[var(--reader-ink)] lg:hidden">
          {bookTitle}
        </p>
        <p className="hidden truncate font-reading text-body-sm text-[var(--reader-ink)] lg:block">
          {chapterTitle}
        </p>
      </div>

      <button
        type="button"
        onClick={onToggleBookmark}
        title={hasBookmark ? 'Убрать закладку' : 'Поставить закладку'}
        aria-label={hasBookmark ? 'Убрать закладку' : 'Поставить закладку'}
        aria-pressed={hasBookmark}
        className="reader-icon-btn"
      >
        <BookmarkIconType size={20} />
      </button>

      {canCollect && (
        <button
          type="button"
          onClick={onToggleNotes}
          aria-label={`Конспект, слов: ${notesCount}`}
          aria-expanded={notesVisible}
          title="Конспект"
          data-active={notesVisible}
          className="reader-icon-btn"
        >
          <NotebookIcon size={20} />
          <span className="tabular-nums">{notesCount}</span>
        </button>
      )}

      <TextSettingsMenu
        open={textSettings.open}
        onToggle={textSettings.onToggle}
        fontSize={textSettings.fontSize}
        lineWidth={textSettings.lineWidth}
        onFontSizeChange={textSettings.onFontSizeChange}
        onLineWidthChange={textSettings.onLineWidthChange}
        onReset={textSettings.onReset}
      />

      <button
        type="button"
        onClick={onToggleParallel}
        title="Параллельный перевод"
        aria-label="Параллельный перевод"
        aria-pressed={parallelMode}
        className="reader-icon-btn font-semibold"
      >
        {parallelMode ? 'RU' : 'EN'}
      </button>

      {!parallelMode && (
        <button
          type="button"
          onClick={onTogglePanel}
          title={panelOpen ? 'Свернуть перевод' : 'Показать перевод'}
          aria-label={panelOpen ? 'Свернуть панель перевода' : 'Показать панель перевода'}
          aria-expanded={panelOpen}
          data-active={panelOpen}
          className="reader-icon-btn hidden lg:inline-flex"
        >
          <ChevronRightIcon size={20} className={panelOpen ? '' : 'rotate-180'} />
        </button>
      )}
    </header>
  );
}
