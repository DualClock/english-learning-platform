'use client';

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
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="w-full sm:w-48">
        <div className="flex justify-between text-xs text-[var(--color-slate)] mb-1">
          <span>{content.progress}%</span>
          <span>{content.wordsRead.toLocaleString()} / {content.totalWords.toLocaleString()}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${content.progress}%` }}></div>
        </div>
      </div>
      <span className="text-sm tabular-nums text-[var(--color-slate)]">
        {content.currentPage} / {content.totalPages}
      </span>

      {/* Доля знакомых слов на текущей странице */}
      {pageDifficulty && (
        <span
          className="inline-flex h-10 items-center gap-1 rounded-full border border-[var(--color-hairline-strong)] bg-white px-3 text-sm text-[var(--color-slate)] shadow-md"
          title={`Знакомых: ${pageDifficulty.knownPercent}% · изучаемых: ${pageDifficulty.learningPercent}% · новых: ${pageDifficulty.newPercent}%`}
        >
          <span className="font-semibold text-[var(--color-primary)]">
            {Math.round(pageDifficulty.knownPercent)}%
          </span>
          <span className="hidden sm:inline">знакомых</span>
        </span>
      )}

      <button
        type="button"
        onClick={onOpenDrawer}
        title="Оглавление"
        aria-label="Оглавление"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-hairline-strong)] bg-white text-[var(--color-slate)] shadow-md transition-colors hover:bg-[var(--color-tint-mint)]"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onToggleBookmark}
        title={hasBookmark ? 'Убрать закладку' : 'Поставить закладку'}
        aria-label={hasBookmark ? 'Убрать закладку' : 'Поставить закладку'}
        aria-pressed={hasBookmark}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full border text-lg shadow-md transition-colors ${
          hasBookmark
            ? 'border-transparent bg-[var(--color-tint-yellow-bold)] text-[var(--color-ink)]'
            : 'border-[var(--color-hairline-strong)] bg-white text-[var(--color-slate)] hover:bg-[var(--color-tint-mint)]'
        }`}
      >
        <span aria-hidden="true">{hasBookmark ? '★' : '☆'}</span>
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
        className={`h-10 px-3.5 rounded-full text-sm font-semibold shadow-md transition-colors ${
          parallelMode
            ? 'bg-[var(--color-tint-yellow-bold)] text-[var(--color-ink)] hover:bg-[#E3BF5F]'
            : 'bg-white border border-[var(--color-hairline-strong)] text-[var(--color-slate)] hover:bg-[var(--color-tint-mint)]'
        }`}
      >
        {parallelMode ? 'RU ⇄' : 'EN'}
      </button>

      {/* Свернуть/развернуть панель перевода — только на десктопе */}
      {!parallelMode && (
        <button
          type="button"
          onClick={onTogglePanel}
          title={panelOpen ? 'Свернуть перевод' : 'Показать перевод'}
          aria-label={panelOpen ? 'Свернуть панель перевода' : 'Показать панель перевода'}
          aria-expanded={panelOpen}
          className="hidden h-10 w-10 items-center justify-center rounded-full border border-[var(--color-hairline-strong)] bg-white text-[var(--color-slate)] shadow-md transition-colors hover:bg-[var(--color-tint-mint)] md:inline-flex"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={panelOpen ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} />
          </svg>
        </button>
      )}

      {canCollect && (
        <button
          onClick={onToggleNotes}
          className="relative h-10 min-w-10 rounded-full bg-[var(--color-tint-yellow-bold)] px-2 text-[var(--color-ink)] font-semibold shadow-md hover:shadow-lg transition-shadow"
          title="Конспект"
          aria-label={`Конспект, слов: ${notesCount}`}
          aria-expanded={notesVisible}
        >
          ✦ {notesCount}
        </button>
      )}
    </div>
  );
}
