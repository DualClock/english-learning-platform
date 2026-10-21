'use client';

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
      <div className="fixed inset-0 z-40 bg-[rgba(11,37,69,0.35)]" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Оглавление и закладки"
        className="fixed right-0 top-0 z-50 flex h-full w-80 max-w-[85vw] flex-col bg-white shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-hairline-strong)] px-3 py-3">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onTabChange('toc')}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                tab === 'toc'
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-slate)] hover:bg-[var(--color-tint-mint)]'
              }`}
            >
              Оглавление
            </button>
            <button
              type="button"
              onClick={() => onTabChange('bookmarks')}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                tab === 'bookmarks'
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-slate)] hover:bg-[var(--color-tint-mint)]'
              }`}
            >
              Закладки ({bookmarks.length})
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="p-1 text-xl leading-none text-[var(--color-slate)] transition-colors hover:text-[var(--color-ink)]"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {tab === 'toc' ? (
            tocLoading ? (
              <p className="p-3 text-sm text-[var(--color-slate)]">Загружаем оглавление…</p>
            ) : tocItems.length === 0 ? (
              <p className="p-3 text-sm text-[var(--color-slate)]">
                В этой книге нет оглавления — листайте страницы стрелками.
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
                      className="flex w-full items-center justify-between gap-2 rounded-lg py-2 pr-2 text-left text-sm text-[var(--color-ink)] transition-colors hover:bg-[var(--color-tint-mint)]"
                      style={{ paddingLeft: `${0.5 + item.level * 0.75}rem` }}
                    >
                      <span className="truncate">{item.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-[var(--color-slate)]">
                        {item.page}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : bookmarks.length === 0 ? (
            <p className="p-3 text-sm text-[var(--color-slate)]">
              Пока нет закладок. Нажмите ☆ в шапке, чтобы отметить страницу.
            </p>
          ) : (
            <ul className="space-y-1">
              {bookmarks.map((bookmark) => (
                <li
                  key={bookmark.id}
                  className="flex items-center gap-2 rounded-lg p-1 hover:bg-[var(--color-surface)]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onPage(bookmark.page);
                      onClose();
                    }}
                    className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm text-[var(--color-ink)]"
                  >
                    Страница {bookmark.page}
                    {bookmark.note && (
                      <span className="mt-0.5 block truncate text-xs text-[var(--color-slate)]">
                        {bookmark.note}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Удалить закладку на странице ${bookmark.page}`}
                    onClick={() => onDeleteBookmark(bookmark.id)}
                    className="shrink-0 px-2 text-lg leading-none text-[var(--color-error)] hover:text-[#8F4343]"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
