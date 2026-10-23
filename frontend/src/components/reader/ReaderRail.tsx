'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { formatNumber } from '@/lib/format';
import { CloseIcon } from '@/components/ui/icons';
import type {
  Book,
  BookContent,
  Bookmark,
  CollectedWord,
  PageDifficulty,
  ReaderRailTab,
  TocItem,
} from './types';

interface Props {
  book: Book;
  content: BookContent;
  currentPage: number;
  pageDifficulty: PageDifficulty | null;
  tocItems: TocItem[];
  tocLoading: boolean;
  bookmarks: Bookmark[];
  tab: ReaderRailTab;
  onTabChange: (tab: ReaderRailTab) => void;
  collected: CollectedWord[];
  canCollect: boolean;
  isFinishing: boolean;
  onPage: (page: number) => void;
  onDeleteBookmark: (id: number) => void;
  onRemoveCollected: (word: string) => void;
  onFinish: () => void;
  onClose?: () => void;
}

function initialsOf(title: string) {
  return (
    title
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('') || 'L'
  );
}

/**
 * Ползунок страниц. Пока его тянут, показывает черновую страницу и не дёргает
 * API на каждый пиксель: переход случается на отпускании, клавише или потере фокуса.
 */
function PageSlider({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const [draft, setDraft] = useState(page);

  useEffect(() => {
    setDraft(page);
  }, [page]);

  const commit = useCallback(() => {
    if (draft !== page) onPage(draft);
  }, [draft, onPage, page]);

  const percent = total > 1 ? ((draft - 1) / (total - 1)) * 100 : 0;

  return (
    <input
      type="range"
      min={1}
      max={Math.max(total, 1)}
      step={1}
      value={draft}
      onChange={(event) => setDraft(Number(event.target.value))}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      aria-label="Страница книги"
      className="rail-range mt-1"
      style={{ '--rail-progress': `${percent}%` } as CSSProperties}
    />
  );
}

/**
 * Книжная полка читалки: корешок книги, прогресс, содержание, закладки,
 * конспект и завершение чтения. Одна и та же на десктопе и в мобильном drawer.
 */
export default function ReaderRail({
  book,
  content,
  currentPage,
  pageDifficulty,
  tocItems,
  tocLoading,
  bookmarks,
  tab,
  onTabChange,
  collected,
  canCollect,
  isFinishing,
  onPage,
  onDeleteBookmark,
  onRemoveCollected,
  onFinish,
  onClose,
}: Props) {
  // Активная глава — последняя, что началась до текущей страницы.
  let activeTocIndex = -1;
  tocItems.forEach((item, index) => {
    if (item.page <= currentPage) activeTocIndex = index;
  });

  const tabClass = (isActive: boolean) =>
    `relative -mb-px inline-flex min-h-11 shrink-0 items-end pb-3 pt-2 text-caption font-medium transition-colors duration-fast ease-soft ${
      isActive ? 'text-on-dark' : 'text-on-dark-muted hover:text-on-dark'
    }`;

  return (
    <aside
      aria-label="Книжная полка"
      className="flex h-full w-[288px] max-w-full flex-col bg-navy text-on-dark"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Link href="/books" className="rail-icon-btn -ml-2" aria-label="Вернуться в библиотеку">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <span className="text-caption font-semibold uppercase tracking-[0.18em] text-on-dark-muted">
          Lexicon
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rail-icon-btn -mr-2 ml-auto"
            aria-label="Закрыть оглавление"
          >
            <CloseIcon size={20} />
          </button>
        )}
      </div>

      <div className="shrink-0 px-5 pb-5 pt-1">
        <div className="flex gap-4">
          <div className="relative h-[86px] w-[60px] shrink-0 overflow-hidden rounded-[3px] bg-[#F2E7D2] text-navy shadow-[0_10px_22px_-12px_rgba(0,0,0,0.75)]">
            <span className="absolute inset-y-0 left-0 w-[3px] bg-navy/15" aria-hidden="true" />
            <span className="flex h-full items-center justify-center font-reading text-lg font-semibold">
              {initialsOf(book.title)}
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="line-clamp-3 font-heading text-body-sm font-semibold leading-snug text-on-dark">
              {book.title}
            </h1>
            <p className="mt-1 truncate text-caption text-on-dark-muted">
              {book.author || 'Без автора'}
            </p>
            {pageDifficulty && (
              <p className="mt-2.5 text-caption text-on-dark-muted">
                {pageDifficulty.knownPercent > 0 ? (
                  <>
                    <span className="font-semibold tabular-nums text-tint-teal">
                      {Math.round(pageDifficulty.knownPercent)}%
                    </span>{' '}
                    знакомых на странице
                  </>
                ) : (
                  'Новая страница'
                )}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-2 text-caption text-on-dark-muted">
            <span>
              <span className="font-semibold tabular-nums text-on-dark">{content.progress}%</span>{' '}
              прочитано
            </span>
            <span className="tabular-nums">
              {formatNumber(content.wordsRead)} / {formatNumber(content.totalWords)}
            </span>
          </div>
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-tint-teal transition-[width] duration-base ease-soft motion-reduce:transition-none"
              style={{ width: `${Math.min(100, Math.max(0, content.progress))}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex shrink-0 gap-4 border-b border-white/10 px-4">
        <button
          type="button"
          onClick={() => onTabChange('toc')}
          aria-current={tab === 'toc' ? 'true' : undefined}
          className={tabClass(tab === 'toc')}
        >
          Главы
          {tab === 'toc' && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-tint-teal" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => onTabChange('bookmarks')}
          aria-current={tab === 'bookmarks' ? 'true' : undefined}
          className={tabClass(tab === 'bookmarks')}
        >
          Закладки
          <span className="ml-1.5 tabular-nums text-on-dark-muted">{bookmarks.length}</span>
          {tab === 'bookmarks' && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-tint-teal" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => onTabChange('notes')}
          aria-current={tab === 'notes' ? 'true' : undefined}
          className={tabClass(tab === 'notes')}
        >
          Конспект
          <span className="ml-1.5 tabular-nums text-on-dark-muted">{collected.length}</span>
          {tab === 'notes' && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-tint-teal" aria-hidden="true" />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2 [scrollbar-color:rgba(255,255,255,0.2)_transparent] [scrollbar-width:thin]">
        {tab === 'toc' && (
          <>
            {tocLoading ? (
              <p className="px-3 py-3 text-caption text-on-dark-muted">Загружаем оглавление…</p>
            ) : tocItems.length === 0 ? (
              <p className="px-3 py-3 text-caption leading-relaxed text-on-dark-muted">
                В этой книге нет оглавления — листайте страницы стрелками или свайпом.
              </p>
            ) : (
              <ul>
                {tocItems.map((item, index) => {
                  const isActive = index === activeTocIndex;
                  return (
                    <li key={`${item.page}-${index}`}>
                      <button
                        type="button"
                        onClick={() => onPage(item.page)}
                        aria-current={isActive ? 'location' : undefined}
                        title={item.title}
                        className={`relative flex min-h-11 w-full items-start justify-between gap-2 rounded-[4px] py-2 pr-2.5 text-left text-caption leading-snug transition-colors duration-fast ease-soft ${
                          isActive
                            ? 'bg-white/[0.09] text-on-dark'
                            : 'text-on-dark-muted hover:bg-white/[0.06] hover:text-on-dark'
                        }`}
                        style={{ paddingLeft: `${10 + Math.min(Math.max(item.level, 0), 3) * 10}px` }}
                      >
                        {isActive && (
                          <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-tint-teal" aria-hidden="true" />
                        )}
                        <span className="line-clamp-2">{item.title}</span>
                        <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-on-dark-muted">
                          {item.page}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {tab === 'bookmarks' && (
          <>
            {bookmarks.length === 0 ? (
              <p className="px-3 py-3 text-caption leading-relaxed text-on-dark-muted">
                Пока нет закладок. Нажмите на флажок в верхней панели, чтобы отметить страницу.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {bookmarks.map((bookmark) => (
                  <li
                    key={bookmark.id}
                    className={`flex items-center gap-1 rounded-[4px] ${
                      bookmark.page === currentPage ? 'bg-white/[0.09]' : 'hover:bg-white/[0.06]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onPage(bookmark.page)}
                      className="min-h-11 min-w-0 flex-1 rounded-[4px] px-2.5 py-2 text-left text-caption leading-snug text-on-dark"
                    >
                      Страница {bookmark.page}
                      {bookmark.note && (
                        <span className="mt-0.5 block truncate text-[11px] text-on-dark-muted">
                          {bookmark.note}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteBookmark(bookmark.id)}
                      aria-label={`Удалить закладку на странице ${bookmark.page}`}
                      className="rail-icon-btn h-11 w-11 text-on-dark-muted hover:text-on-dark"
                    >
                      <CloseIcon size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'notes' && (
          <>
            {!canCollect ? (
              <p className="px-3 py-3 text-caption leading-relaxed text-on-dark-muted">
                Готовим конспект чтения — это займёт секунду.
              </p>
            ) : collected.length === 0 ? (
              <p className="px-3 py-3 text-caption leading-relaxed text-on-dark-muted">
                Пока пусто. Нажимайте на слова с пунктиром в тексте — они соберутся сюда,
                а в конце чтения станут мини-тестом.
              </p>
            ) : (
              <ul className="space-y-1">
                {collected.map((item) => (
                  <li
                    key={item.text}
                    className="group flex min-h-11 items-start gap-1 rounded-[4px] px-2 py-2 hover:bg-white/[0.06]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-caption font-medium text-on-dark">{item.text}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-on-dark-muted">
                        стр. {item.page}
                        {item.sentence ? ` · ${item.sentence}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveCollected(item.text)}
                      aria-label={`Убрать ${item.text} из конспекта`}
                      className="rail-icon-btn h-11 w-11 shrink-0 text-on-dark-muted hover:text-on-dark"
                    >
                      <CloseIcon size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-white/10 px-5 py-4">
        <div className="flex items-baseline justify-between gap-2 text-caption text-on-dark-muted">
          <span>Страница</span>
          <span className="tabular-nums text-on-dark">
            {currentPage} / {content.totalPages}
          </span>
        </div>
        <PageSlider page={currentPage} total={content.totalPages} onPage={onPage} />
        {canCollect && (
          <button
            type="button"
            onClick={onFinish}
            disabled={isFinishing}
            className="mt-3 flex h-11 w-full items-center justify-center rounded-md border border-white/15 text-caption font-medium text-on-dark transition-colors duration-fast ease-soft hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isFinishing ? 'Завершаем…' : 'Завершить чтение'}
          </button>
        )}
      </div>
    </aside>
  );
}
