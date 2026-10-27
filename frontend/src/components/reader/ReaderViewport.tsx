'use client';

import {
  forwardRef,
  Fragment,
  useCallback,
  useImperativeHandle,
  useRef,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePaginator } from '@/hooks/reader/usePaginator';
import { resolveApiAssetUrl } from '@/lib/reader/api';
import { wordAtPoint, type PointWord } from '@/lib/reader/wordAtPoint';
import type { ReaderAnchor } from '@/lib/reader/pagination';
import { readerLayoutKey } from '@/lib/reader/settings';
import type { ReaderBlock, ReaderChapter, ReaderSettings } from '@/lib/reader/types';

export interface ReaderViewportHandle {
  nextPage: () => void;
  previousPage: () => void;
  goToPage: (page: number) => void;
  goToAnchor: (anchor: ReaderAnchor) => void;
  ensureVisible: (anchor: ReaderAnchor) => void;
}

interface Props {
  chapter: ReaderChapter;
  initialAnchor?: ReaderAnchor | null;
  settings: ReaderSettings;
  activeSentenceId?: string | null;
  onPageChange: (anchor: ReaderAnchor | null, page: number, total: number) => void;
  onWordTap: (word: PointWord, chapter: ReaderChapter) => void;
  onEndReached: () => void;
}

const SWIPE_MIN_DISTANCE = 56;
const SWIPE_DIRECTION_RATIO = 1.35;

function BlockView({ block, activeSentenceId }: { block: ReaderBlock; activeSentenceId?: string | null }) {
  if (block.type === 'image') {
    const src = resolveApiAssetUrl(block.assetUrl);
    if (!src) return null;

    return (
      <figure className="reader-block reader-figure" data-block="image" data-no-page-turn>
        <img
          src={src}
          alt={block.alt ?? ''}
          width={block.width ?? undefined}
          height={block.height ?? undefined}
          loading="lazy"
          decoding="async"
          draggable={false}
          style={
            block.width && block.height
              ? { aspectRatio: `${block.width} / ${block.height}` }
              : undefined
          }
        />
        {block.caption ? <figcaption className="reader-figcaption">{block.caption}</figcaption> : null}
      </figure>
    );
  }

  if (block.type === 'separator') {
    return <hr className="reader-block reader-separator" data-block="separator" />;
  }

  const content = block.sentences.map((sentence, index) => (
    <Fragment key={sentence.id}>
      <span data-s={sentence.id} data-listening={sentence.id === activeSentenceId ? 'true' : undefined}>
        {sentence.text}
      </span>
      {block.type === 'verse' ? '\n' : index < block.sentences.length - 1 ? ' ' : null}
    </Fragment>
  ));

  if (block.type === 'heading') {
    return (
      <h2 className="reader-block reader-heading" data-block="heading">
        {content}
      </h2>
    );
  }

  if (block.type === 'quote') {
    return (
      <blockquote className="reader-block reader-quote" data-block="quote">
        {content}
      </blockquote>
    );
  }

  if (block.type === 'listItem') {
    return (
      <p className="reader-block reader-list-item" data-block="listItem">
        {content}
      </p>
    );
  }

  if (block.type === 'verse') {
    return (
      <p className="reader-block reader-verse" data-block="verse">
        {content}
      </p>
    );
  }

  return (
    <p className="reader-block reader-paragraph" data-block="paragraph">
      {content}
    </p>
  );
}

const ReaderViewport = forwardRef<ReaderViewportHandle, Props>(function ReaderViewport(
  { chapter, initialAnchor = null, settings, activeSentenceId = null, onPageChange, onWordTap, onEndReached },
  ref
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const handlePaginatorChange = useCallback(
    (page: number, total: number, anchor: ReaderAnchor | null) => {
      onPageChange(anchor, page, total);
    },
    [onPageChange]
  );

  const paginator = usePaginator({
    viewportRef,
    flowRef,
    contentKey: chapter.id,
    layoutKey: readerLayoutKey(settings),
    initialAnchor,
    onPageChange: handlePaginatorChange,
  });

  const goNext = useCallback(() => {
    if (paginator.page >= paginator.totalPages - 1) {
      onEndReached();
      return;
    }
    paginator.nextPage();
  }, [onEndReached, paginator]);

  const goPrevious = useCallback(() => {
    if (paginator.page <= 0) return;
    paginator.previousPage();
  }, [paginator]);

  useImperativeHandle(
    ref,
    () => ({
      nextPage: goNext,
      previousPage: goPrevious,
      goToPage: paginator.goToPage,
      goToAnchor: paginator.goToAnchor,
      ensureVisible: paginator.ensureVisible,
    }),
    [goNext, goPrevious, paginator.ensureVisible, paginator.goToAnchor, paginator.goToPage]
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const selected = window.getSelection()?.toString().trim();

    if (!selected && Math.abs(dx) > SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy) * SWIPE_DIRECTION_RATIO) {
      if (dx < 0) goNext();
      else goPrevious();
      return;
    }

    if (selected || Math.abs(dx) > 10 || Math.abs(dy) > 10) return;

    const target = event.target as HTMLElement;
    if (target.closest('[data-no-page-turn]')) return;

    const word = wordAtPoint(event.clientX, event.clientY);
    if (word) {
      onWordTap(word, chapter);
      return;
    }

    // Пустое место у края страницы — тоже способ перелистнуть.
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    if (event.clientX < rect.left + rect.width * 0.12) {
      goPrevious();
    } else if (event.clientX > rect.right - rect.width * 0.12) {
      goNext();
    }
  };

  return (
    <div className="reader-sheet">
      <div className="reader-page-pad">
        <div
          ref={viewportRef}
          className="reader-viewport"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          style={{ touchAction: 'pan-y', opacity: paginator.isReady ? 1 : 0 }}
        >
          <div
            ref={flowRef}
            lang="en"
            className="reader-flow"
            aria-hidden={!paginator.isReady}
            data-chapter={chapter.id}
          >
            {chapter.blocks.map((block) => (
              <BlockView key={block.id} block={block} activeSentenceId={activeSentenceId} />
            ))}
          </div>
        </div>
      </div>

      {!paginator.isReady ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col gap-4 px-[9%] py-[7%]" aria-hidden="true">
          <span className="h-6 w-2/3 animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-full animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-11/12 animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-full animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-3/4 animate-pulse rounded bg-[var(--reader-wash)]" />
        </div>
      ) : null}
    </div>
  );
});

export default ReaderViewport;
