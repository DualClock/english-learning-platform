'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import { NotebookIcon } from '@/components/ui/icons';
import { useReaderChapter } from '@/hooks/reader/useReaderChapter';
import { useReaderPocket } from '@/hooks/reader/useReaderPocket';
import { useReaderSession } from '@/hooks/reader/useReaderSession';
import { useProgressSync } from '@/hooks/reader/useProgressSync';
import { useListening } from '@/hooks/reader/useListening';
import {
  addReaderBookmark,
  deleteReaderBookmark,
  getChapterReview,
  markBookFinished,
} from '@/lib/reader/api';
import type { PointWord } from '@/lib/reader/wordAtPoint';
import {
  DEFAULT_READER_SETTINGS,
  type ReaderAnchor,
  type ReaderBookmark,
  type ReaderChapter,
  type ReaderManifestChapter,
  type ReaderPocketItem,
  type ReaderSettings,
} from '@/lib/reader/types';
import { loadReaderSettings, saveReaderSettings } from '@/lib/reader/settings';
import ChapterEndSheet from './ChapterEndSheet';
import ListenBar from './ListenBar';
import ReaderChrome from './ReaderChrome';
import ReaderContentsDrawer, { type ReaderDrawerTab } from './ReaderContentsDrawer';
import ReaderSettingsSheet from './ReaderSettingsSheet';
import ReaderV3Skeleton from './ReaderV3Skeleton';
import ReaderViewport, { type ReaderViewportHandle } from './ReaderViewport';
import WordSheet from './WordSheet';

interface Props {
  bookId: number;
  token?: string;
  userId?: string | null;
}

interface WordPopup {
  word: PointWord;
  chapterId: string;
}

function firstAnchor(chapterId: string, sentenceId?: string | null): ReaderAnchor | null {
  return sentenceId ? { sentenceId, charOffset: 0 } : null;
}

/**
 * Старые ссылки вида ?page=5 пришли из мира синтетических страниц по 300
 * слов. Находим главу, в которой лежит этот кусок текста, и открываем её
 * начало: точнее без разбора главы не сказать, а приблизительно — честно.
 */
function chapterForLegacyPage(chapters: ReaderManifestChapter[], page: number): string | null {
  if (page < 1 || chapters.length === 0) return null;
  const words = (page - 1) * 300;
  let found = chapters[0].id;
  for (const chapter of chapters) {
    if (chapter.wordStart <= words) found = chapter.id;
    else break;
  }
  return found;
}

export default function ReaderShell({ bookId, token, userId = null }: Props) {
  const { manifest, isLoading, error, reload, updateBookmarks } = useReaderSession(bookId, token);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [initialAnchor, setInitialAnchor] = useState<ReaderAnchor | null>(null);
  const {
    chapter,
    isLoading: chapterLoading,
    error: chapterError,
    prefetch,
    reload: reloadChapter,
  } = useReaderChapter(bookId, chapterId, token);
  const pocket = useReaderPocket(bookId, token);
  const progress = useProgressSync(bookId, token);

  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<ReaderDrawerTab>('toc');
  const [chromeVisible, setChromeVisible] = useState(true);
  const [pageState, setPageState] = useState({ page: 0, total: 1 });
  const [currentAnchor, setCurrentAnchor] = useState<ReaderAnchor | null>(null);
  const [wordPopup, setWordPopup] = useState<WordPopup | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReaderPocketItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const viewportRef = useRef<ReaderViewportHandle>(null);
  const initializedRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeChapter = chapter && chapter.id === chapterId ? chapter : null;

  const listening = useListening({
    bookId,
    chapter: activeChapter,
    token,
    onSentenceChange: (sentence) => {
      viewportRef.current?.ensureVisible({ sentenceId: sentence.id, charOffset: 0 });
    },
  });
  const stopListening = listening.stop;

  useEffect(() => {
    setSettings(loadReaderSettings());
    setSettingsLoaded(true);
  }, []);

  useEffect(() => {
    if (settingsLoaded) saveReaderSettings(settings);
  }, [settings, settingsLoaded]);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setChromeVisible(false), 3200);
  }, []);

  useEffect(() => {
    showChrome();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showChrome]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  // Восстановление места: URL важнее серверной позиции, серверная — важнее
  // старого номера страницы. GET манифеста ничего не перезаписывает.
  useEffect(() => {
    if (!manifest || initializedRef.current || manifest.manifest.length === 0) return;
    initializedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const urlChapter = params.get('ch');
    const urlSentence = params.get('s');
    const urlOffset = Number(params.get('o')) || 0;
    const legacyPage = Number(params.get('page')) || 0;

    const knownChapter = (id: string | null): id is string =>
      Boolean(id) && manifest.manifest.some((item) => item.id === id);

    const legacyChapterId = !knownChapter(urlChapter) && legacyPage > 1
      ? chapterForLegacyPage(manifest.manifest, legacyPage)
      : null;

    const startChapter = knownChapter(urlChapter)
      ? urlChapter
      : knownChapter(legacyChapterId)
        ? legacyChapterId
        : knownChapter(manifest.position.chapterId)
          ? manifest.position.chapterId
          : manifest.manifest[0].id;

    const startAnchor =
      knownChapter(urlChapter) && urlSentence
        ? { sentenceId: urlSentence, charOffset: Math.max(0, urlOffset) }
        : legacyChapterId === startChapter
          ? null
          : manifest.position.chapterId === startChapter
          ? {
              sentenceId: manifest.position.sentenceId,
              charOffset: Math.max(0, manifest.position.charOffset),
            }
          : firstAnchor(startChapter);

    setChapterId(startChapter);
    setInitialAnchor(startAnchor);
    setCurrentAnchor(startAnchor);
    showChrome();
  }, [manifest, showChrome]);

  useEffect(() => {
    if (!manifest || !activeChapter) return;
    const index = manifest.manifest.findIndex((item) => item.id === activeChapter.id);
    const next = manifest.manifest[index + 1];
    if (next) void prefetch(next.id);
  }, [activeChapter, manifest, prefetch]);

  const handlePageChange = useCallback(
    (anchor: ReaderAnchor | null, page: number, total: number) => {
      setPageState({ page: page + 1, total });
      if (anchor) {
        setCurrentAnchor(anchor);
        if (chapterId) {
          progress.schedule(anchor, chapterId);
          try {
            const url = new URL(window.location.href);
            url.searchParams.set('ch', chapterId);
            url.searchParams.set('s', anchor.sentenceId);
            if (anchor.charOffset > 0) url.searchParams.set('o', String(anchor.charOffset));
            else url.searchParams.delete('o');
            window.history.replaceState({}, '', url);
          } catch {
            // URL — удобство, а не условие чтения
          }
        }
      }
      showChrome();
    },
    [chapterId, progress, showChrome]
  );

  const selectChapter = useCallback(
    (nextChapterId: string, anchor: ReaderAnchor | null = null) => {
      progress.flush(false);
      stopListening();
      setWordPopup(null);
      setReviewOpen(false);
      setDrawerOpen(false);
      setSettingsOpen(false);

      if (nextChapterId === chapterId) {
        if (anchor) {
          viewportRef.current?.goToAnchor(anchor);
          setCurrentAnchor(anchor);
        } else {
          viewportRef.current?.goToPage(0);
        }
        showChrome();
        return;
      }

      setChapterId(nextChapterId);
      setInitialAnchor(anchor);
      setCurrentAnchor(anchor);
      setPageState({ page: 0, total: 1 });
      showChrome();
    },
    [chapterId, progress, showChrome, stopListening]
  );

  const nextChapter = useMemo(() => {
    if (!manifest || !activeChapter) return null;
    const index = manifest.manifest.findIndex((item) => item.id === activeChapter.id);
    return manifest.manifest[index + 1] ?? null;
  }, [activeChapter, manifest]);

  const openReview = useCallback(async () => {
    if (!activeChapter || !token) return;
    stopListening();
    setWordPopup(null);
    setDrawerOpen(false);
    setSettingsOpen(false);
    setChromeVisible(false);
    setReviewOpen(true);
    setReviewLoading(true);
    setReviewError('');
    try {
      const data = await getChapterReview(bookId, activeChapter.id, token);
      setReviewItems(data.items);
    } catch {
      setReviewError('Не удалось собрать разбор главы. Попробуйте ещё раз.');
    } finally {
      setReviewLoading(false);
    }
  }, [activeChapter, bookId, stopListening, token]);

  const closeReview = useCallback(() => {
    setReviewOpen(false);
    showChrome();
  }, [showChrome]);

  const isLastChapter = useMemo(() => {
    if (!manifest || !activeChapter) return false;
    return manifest.manifest[manifest.manifest.length - 1]?.id === activeChapter.id;
  }, [activeChapter, manifest]);

  const handleFinish = useCallback(async () => {
    if (!token || !activeChapter || finishing) return;
    setFinishing(true);
    try {
      await markBookFinished(bookId, token, activeChapter.id);
      await reload();
      setToast('Книга дочитана');
      setReviewOpen(false);
      showChrome();
    } catch {
      setToast('Не удалось отметить книгу прочитанной');
    } finally {
      setFinishing(false);
    }
  }, [activeChapter, bookId, finishing, reload, showChrome, token]);

  const handleWordTap = useCallback((word: PointWord, tappedChapter: ReaderChapter) => {
    if (!tappedChapter) return;
    stopListening();
    setDrawerOpen(false);
    setSettingsOpen(false);
    setReviewOpen(false);
    setChromeVisible(false);
    setWordPopup({ word, chapterId: tappedChapter.id });
  }, [stopListening]);

  const closeWord = useCallback(() => {
    setWordPopup(null);
    showChrome();
  }, [showChrome]);

  const currentBookmark = useMemo<ReaderBookmark | null>(() => {
    if (!manifest || !chapterId || !currentAnchor) return null;
    return (
      manifest.bookmarks.find(
        (bookmark) => bookmark.chapterId === chapterId && bookmark.sentenceId === currentAnchor.sentenceId
      ) ?? null
    );
  }, [chapterId, currentAnchor, manifest]);

  const toggleBookmark = useCallback(async () => {
    if (!token || !activeChapter) return;
    const anchor =
      currentAnchor ??
      (activeChapter.blocks.flatMap((block) => block.sentences)[0]
        ? {
            sentenceId: activeChapter.blocks.flatMap((block) => block.sentences)[0].id,
            charOffset: 0,
          }
        : null);
    if (!anchor) return;

    try {
      if (currentBookmark) {
        await deleteReaderBookmark(bookId, currentBookmark.id, token);
        updateBookmarks(manifest?.bookmarks.filter((bookmark) => bookmark.id !== currentBookmark.id) ?? []);
        setToast('Закладка убрана');
      } else {
        const created = await addReaderBookmark(bookId, token, {
          chapterId: activeChapter.id,
          sentenceId: anchor.sentenceId,
          charOffset: anchor.charOffset,
        });
        updateBookmarks([...(manifest?.bookmarks ?? []), created]);
        setToast('Закладка добавлена');
      }
    } catch {
      setToast('Не удалось сохранить закладку');
    }
  }, [activeChapter, bookId, currentAnchor, currentBookmark, manifest, token, updateBookmarks]);

  const deleteBookmark = useCallback(
    async (bookmarkId: number) => {
      if (!token) return;
      try {
        await deleteReaderBookmark(bookId, bookmarkId, token);
        updateBookmarks(manifest?.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId) ?? []);
        setToast('Закладка убрана');
      } catch {
        setToast('Не удалось убрать закладку');
      }
    },
    [bookId, manifest, token, updateBookmarks]
  );

  const selectBookmark = useCallback(
    (bookmark: ReaderBookmark) => {
      if (!bookmark.chapterId) return;
      const anchor = bookmark.sentenceId
        ? { sentenceId: bookmark.sentenceId, charOffset: bookmark.charOffset || 0 }
        : null;
      selectChapter(bookmark.chapterId, anchor);
    },
    [selectChapter]
  );

  const selectPocket = useCallback(
    (item: ReaderPocketItem) => {
      if (!item.chapterId) return;
      selectChapter(item.chapterId, item.sentenceId ? { sentenceId: item.sentenceId, charOffset: 0 } : null);
    },
    [selectChapter]
  );

  const openDrawer = useCallback(
    (tab: ReaderDrawerTab) => {
      stopListening();
      setWordPopup(null);
      setSettingsOpen(false);
      setReviewOpen(false);
      setDrawerTab(tab);
      setDrawerOpen(true);
      setChromeVisible(false);
      if (tab === 'pocket') void pocket.refresh();
    },
    [pocket, stopListening]
  );

  const openSettings = useCallback(() => {
    stopListening();
    setWordPopup(null);
    setDrawerOpen(false);
    setReviewOpen(false);
    setSettingsOpen(true);
    setChromeVisible(false);
  }, [stopListening]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    showChrome();
  }, [showChrome]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    showChrome();
  }, [showChrome]);

  const handlePromote = useCallback(
    async (pocketId: number) => {
      const ok = await pocket.promote(pocketId);
      if (ok) {
        setReviewItems((items) => items.filter((item) => item.id !== pocketId));
        setToast('Слово ушло в повторение');
        void reload();
      }
      return ok;
    },
    [pocket, reload]
  );

  const handleKnown = useCallback(
    async (pocketId: number) => {
      const ok = await pocket.markKnown(pocketId);
      if (ok) {
        setReviewItems((items) => items.filter((item) => item.id !== pocketId));
        setToast('Слово отмечено знакомым');
        void reload();
      }
      return ok;
    },
    [pocket, reload]
  );

  const handleDeletePocket = useCallback(
    async (pocketId: number) => {
      const ok = await pocket.remove(pocketId);
      if (ok) {
        setReviewItems((items) => items.filter((item) => item.id !== pocketId));
        void reload();
      }
      return ok;
    },
    [pocket, reload]
  );

  const goNextChapter = useCallback(() => {
    if (nextChapter) {
      selectChapter(nextChapter.id);
    }
  }, [nextChapter, selectChapter]);

  const handleListen = useCallback(() => {
    if (listening.status === 'idle') {
      // Начинаем с того предложения, где читатель стоит сейчас, а не с
      // начала главы: «Слушать» продолжает чтение, а не перезапускает его.
      listening.start(currentAnchor?.sentenceId ?? undefined);
    } else {
      listening.toggle();
    }
    showChrome();
  }, [currentAnchor, listening, showChrome]);

  const closeListening = useCallback(() => {
    listening.stop();
    showChrome();
  }, [listening, showChrome]);

  const viewportVars = {
    '--reader-size': `${settings.fontSize}px`,
    '--reader-leading': settings.lineHeight,
    '--reader-page-margin': `${settings.margin}%`,
  } as CSSProperties;

  const bookPercent = useMemo(() => {
    if (!manifest) return 0;
    if (!activeChapter || pageState.total <= 1) {
      return Math.max(manifest.position.maxPercent, activeChapter ? activeChapter.wordStart / Math.max(1, manifest.book.wordCount) * 100 : 0);
    }
    const fraction = pageState.total > 1 ? (pageState.page - 1) / (pageState.total - 1) : 0;
    const words = activeChapter.wordStart + fraction * activeChapter.wordCount;
    return Math.max(manifest.position.maxPercent, (words / Math.max(1, manifest.book.wordCount)) * 100);
  }, [activeChapter, manifest, pageState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (event.key === 'Escape') {
        if (wordPopup) closeWord();
        else if (reviewOpen) closeReview();
        else if (settingsOpen) closeSettings();
        else if (drawerOpen) closeDrawer();
        return;
      }

      if (wordPopup || reviewOpen || settingsOpen || drawerOpen) return;

      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        viewportRef.current?.nextPage();
        showChrome();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        viewportRef.current?.previousPage();
        showChrome();
      } else if (event.key === 'Home') {
        event.preventDefault();
        viewportRef.current?.goToPage(0);
        showChrome();
      } else if (event.key === 'End') {
        event.preventDefault();
        viewportRef.current?.goToPage(pageState.total - 1);
        showChrome();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    closeDrawer,
    closeReview,
    closeSettings,
    closeWord,
    drawerOpen,
    pageState.total,
    reviewOpen,
    settingsOpen,
    showChrome,
    wordPopup,
  ]);

  const stage = (
    <div
      className="reader-stage relative h-[100dvh] w-full overflow-hidden"
      data-reader-theme={settings.theme}
      style={viewportVars}
    >
      <div className="relative mx-auto h-full max-w-[780px]">
        {activeChapter ? (
          <ReaderViewport
            ref={viewportRef}
            chapter={activeChapter}
            initialAnchor={initialAnchor}
            settings={settings}
            activeSentenceId={listening.activeSentenceId}
            onPageChange={handlePageChange}
            onWordTap={handleWordTap}
            onEndReached={() => void openReview()}
          />
        ) : (
          <ReaderV3Skeleton />
        )}

        {/* Тонкие края возвращают шапку, когда она уже растворилась */}
        <button
          type="button"
          aria-label="Показать панель"
          className="absolute inset-x-0 top-0 z-20 h-5"
          onClick={showChrome}
        />
        <button
          type="button"
          aria-label="Показать панель"
          className="absolute inset-x-0 bottom-0 z-20 h-5"
          onClick={showChrome}
        />

        <ReaderChrome
          visible={chromeVisible}
          chapterTitle={activeChapter?.title ?? manifest?.manifest[0]?.title ?? 'Книга'}
          page={pageState.page || 1}
          totalPages={pageState.total || 1}
          bookPercent={bookPercent}
          hasBookmark={Boolean(currentBookmark)}
          pocketCount={manifest?.pocketCount ?? pocket.items.length}
          isListening={listening.status !== 'idle'}
          onToggleBookmark={() => void toggleBookmark()}
          onOpenDrawer={() => openDrawer('toc')}
          onOpenSettings={openSettings}
          onListen={handleListen}
          onPrevious={() => {
            viewportRef.current?.previousPage();
            showChrome();
          }}
          onNext={() => {
            viewportRef.current?.nextPage();
            showChrome();
          }}
        />

        <ListenBar
          open={listening.status !== 'idle'}
          status={listening.status}
          provider={listening.provider}
          index={listening.index}
          total={listening.total}
          error={listening.error}
          onToggle={listening.toggle}
          onPrevious={listening.previous}
          onNext={listening.next}
          onClose={closeListening}
        />

        {activeChapter && pageState.total > 0 && pageState.page >= pageState.total &&
        !reviewOpen && listening.status === 'idle' ? (
          <button
            type="button"
            onClick={() => void openReview()}
            className="absolute bottom-[calc(3.4rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--reader-hairline)] bg-[var(--reader-paper)] px-4 py-2 text-caption font-medium text-[var(--reader-ink)] shadow-card transition-transform hover:-translate-y-0.5"
          >
            <NotebookIcon size={16} />
            Глава прочитана — разобрать
          </button>
        ) : null}

        {toast ? (
          <div
            role="status"
            className="absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-full border border-[var(--reader-hairline)] bg-[var(--reader-paper)] px-3.5 py-2 text-caption text-[var(--reader-ink)] shadow-card"
          >
            {toast}
          </div>
        ) : null}

        {wordPopup ? (
          <WordSheet
            key={`${wordPopup.chapterId}-${wordPopup.word.sentenceId}-${wordPopup.word.word}`}
            bookId={bookId}
            token={token}
            word={wordPopup.word.word}
            sentence={wordPopup.word.sentenceText}
            chapterId={wordPopup.chapterId}
            sentenceId={wordPopup.word.sentenceId}
            onClose={closeWord}
            onSavePocket={pocket.save}
            onPromotePocket={handlePromote}
            onMarkKnown={handleKnown}
            onDeletePocket={handleDeletePocket}
            onPocketChanged={() => void reload()}
          />
        ) : null}

        <ReaderContentsDrawer
          open={drawerOpen}
          tab={drawerTab}
          manifest={manifest ?? {
            book: { id: bookId, title: '', wordCount: 0 },
            manifest: [],
            position: {
              chapterId: '',
              sentenceId: '',
              charOffset: 0,
              maxPercent: 0,
            },
            pocketCount: 0,
            bookmarks: [],
          }}
          currentChapterId={chapterId ?? ''}
          bookmarks={manifest?.bookmarks ?? []}
          pocketItems={pocket.items}
          pocketLoading={pocket.isLoading}
          progressPercent={bookPercent}
          onClose={closeDrawer}
          onTabChange={(tab) => {
            setDrawerTab(tab);
            if (tab === 'pocket') void pocket.refresh();
          }}
          onSelectChapter={(id) => selectChapter(id)}
          onSelectBookmark={selectBookmark}
          onSelectPocket={selectPocket}
          onDeleteBookmark={(id) => void deleteBookmark(id)}
          onPromotePocket={(id) => void handlePromote(id)}
          onMarkKnown={(id) => void handleKnown(id)}
          onDeletePocket={(id) => void handleDeletePocket(id)}
        />

        <ReaderSettingsSheet
          open={settingsOpen}
          settings={settings}
          onChange={setSettings}
          onClose={closeSettings}
        />

        <ChapterEndSheet
          open={reviewOpen}
          items={reviewItems}
          loading={reviewLoading}
          error={reviewError}
          pocketCount={manifest?.pocketCount ?? pocket.items.length}
          hasNextChapter={Boolean(nextChapter)}
          isLastChapter={isLastChapter}
          finished={Boolean(manifest?.position.finishedAt)}
          finishing={finishing}
          userId={userId}
          accessToken={token}
          page={pageState.page}
          onClose={closeReview}
          onPromote={(id) => void handlePromote(id)}
          onKnown={(id) => void handleKnown(id)}
          onNextChapter={() => {
            setReviewOpen(false);
            goNextChapter();
          }}
          onFinish={() => void handleFinish()}
        />
      </div>
    </div>
  );

  if (!manifest && isLoading) {
    return stage;
  }

  if (!manifest) {
    return (
      <div
        className="reader-stage flex h-[100dvh] w-full items-center justify-center px-5"
        data-reader-theme={settings.theme}
        style={viewportVars}
      >
        <div className="w-full max-w-md">
          <ErrorState
            title="Книга не открылась"
            description={error || 'Не удалось загрузить книгу.'}
            onRetry={() => void reload()}
            action={
              <Button href="/books" variant="primary">
                К книгам
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (chapterError) {
    return (
      <div
        className="reader-stage flex h-[100dvh] w-full items-center justify-center px-5"
        data-reader-theme={settings.theme}
        style={viewportVars}
      >
        <div className="w-full max-w-md">
          <ErrorState
            title="Глава не открылась"
            description={chapterError}
            onRetry={reloadChapter}
            action={
              <Button href="/books" variant="primary">
                К книгам
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (!activeChapter && chapterLoading) {
    return stage;
  }

  return stage;
}
