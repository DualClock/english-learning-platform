'use client';

import type { ComponentType } from 'react';
import { motion } from 'motion/react';
import { transition } from '@/lib/motion';
import { formatNumber } from '@/lib/format';
import ProgressBar from '@/components/ui/ProgressBar';
import {
  BookmarkFilledIcon,
  BookmarkIcon,
  ChevronRightIcon,
  MenuIcon,
  NotebookIcon,
} from '@/components/ui/icons';
import type { IconProps } from '@/components/ui/icons';
import type { BookContent, PageDifficulty } from './types';
import TextSettingsMenu from './TextSettingsMenu';

interface Props {
  content: BookContent;
  pageDifficulty: PageDifficulty | null;
  hasBookmark: boolean;
  parallelMode: boolean;
  panelOpen: boolean;
  notesVisible: boolean;
  notesCount: number;
  canCollect: boolean;
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
  onToggleBookmark: () => void;
  onToggleParallel: () => void;
  onTogglePanel: () => void;
  onToggleNotes: () => void;
}

/**
 * Панель управления чтением. Полоса прогресса тянется от ответа сервера,
 * остальные контролы — обычные чипы: отклик нажатием, без тени в покое.
 */
export default function ReaderToolbar({
  content,
  pageDifficulty,
  hasBookmark,
  parallelMode,
  panelOpen,
  notesVisible,
  notesCount,
  canCollect,
  textSettings,
  onOpenDrawer,
  onToggleBookmark,
  onToggleParallel,
  onTogglePanel,
  onToggleNotes,
}: Props) {
  const BookmarkIconType: ComponentType<IconProps> = hasBookmark ? BookmarkFilledIcon : BookmarkIcon;

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="w-full sm:w-48">
        <div className="mb-1 flex justify-between text-caption text-slate">
          <span className="tabular-nums text-primary">{content.progress}%</span>
          <span className="tabular-nums">
            {formatNumber(content.wordsRead)} / {formatNumber(content.totalWords)}
          </span>
        </div>
        <ProgressBar value={content.progress} label="Прогресс чтения" />
      </div>

      <span className="text-body-sm tabular-nums text-slate">
        {content.currentPage} / {content.totalPages}
      </span>

      {/* Доля знакомых слов на текущей странице */}
      {pageDifficulty && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={transition.fast}
          className="inline-flex h-10 items-center gap-1.5 rounded-md border border-hairline-strong bg-canvas px-2.5 text-body-sm text-slate"
          title={`Знакомых: ${pageDifficulty.knownPercent}% · изучаемых: ${pageDifficulty.learningPercent}% · новых: ${pageDifficulty.newPercent}%`}
        >
          <span className="font-semibold tabular-nums text-primary">
            {Math.round(pageDifficulty.knownPercent)}%
          </span>
          <span className="hidden sm:inline">знакомых</span>
        </motion.span>
      )}

      <button
        type="button"
        onClick={onOpenDrawer}
        title="Оглавление"
        aria-label="Оглавление"
        className="icon-chip"
      >
        <MenuIcon size={20} />
      </button>

      <button
        type="button"
        onClick={onToggleBookmark}
        title={hasBookmark ? 'Убрать закладку' : 'Поставить закладку'}
        aria-label={hasBookmark ? 'Убрать закладку' : 'Поставить закладку'}
        aria-pressed={hasBookmark}
        className={hasBookmark ? 'icon-chip border-transparent bg-surface text-ink' : 'icon-chip'}
      >
        <BookmarkIconType size={20} />
      </button>

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
        onClick={onToggleParallel}
        title="Параллельный перевод"
        aria-pressed={parallelMode}
        className={parallelMode ? 'icon-chip-active font-semibold' : 'icon-chip font-semibold'}
      >
        {parallelMode ? 'RU' : 'EN'}
      </button>

      {/* Свернуть/развернуть панель перевода — только на десктопе */}
      {!parallelMode && (
        <button
          type="button"
          onClick={onTogglePanel}
          title={panelOpen ? 'Свернуть перевод' : 'Показать перевод'}
          aria-label={panelOpen ? 'Свернуть панель перевода' : 'Показать панель перевода'}
          aria-expanded={panelOpen}
          className="icon-chip hidden md:inline-flex"
        >
          <ChevronRightIcon size={20} className={panelOpen ? '' : 'rotate-180'} />
        </button>
      )}

      {canCollect && (
        <button
          onClick={onToggleNotes}
          aria-label={`Конспект, слов: ${notesCount}`}
          aria-expanded={notesVisible}
          className={notesVisible ? 'icon-chip-active' : 'icon-chip'}
        >
          <NotebookIcon size={20} />
          <span className="tabular-nums">{notesCount}</span>
        </button>
      )}
    </div>
  );
}
