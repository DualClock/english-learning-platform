'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  clampCharOffset,
  clampPage,
  pageCountFromLastLeft,
  pageIndexFromLeft,
  type ReaderAnchor,
} from '@/lib/reader/pagination';
import { firstVisibleSentence, getCaretRange } from '@/lib/reader/wordAtPoint';

interface UsePaginatorOptions {
  viewportRef: RefObject<HTMLDivElement>;
  flowRef: RefObject<HTMLDivElement>;
  contentKey: string;
  layoutKey: string;
  initialAnchor?: ReaderAnchor | null;
  onPageChange?: (page: number, total: number, anchor: ReaderAnchor | null) => void;
}

interface UsePaginatorResult {
  page: number;
  totalPages: number;
  isReady: boolean;
  captureAnchor: () => ReaderAnchor | null;
  goToPage: (page: number) => void;
  goToAnchor: (anchor: ReaderAnchor) => void;
  ensureVisible: (anchor: ReaderAnchor) => void;
  nextPage: () => void;
  previousPage: () => void;
}

function escapeAttribute(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Постраничный движок: CSS multi-column внутри неподвижного вьюпорта,
 * перелистывание — сдвиг всего потока. Позиция живёт якорем предложения,
 * поэтому смена кегля и поворот не выбрасывают читателя из текста.
 */
export function usePaginator({
  viewportRef,
  flowRef,
  contentKey,
  layoutKey,
  initialAnchor = null,
  onPageChange,
}: UsePaginatorOptions): UsePaginatorResult {
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isReady, setIsReady] = useState(false);

  const pageRef = useRef(0);
  const totalRef = useRef(1);
  const lastAnchorRef = useRef<ReaderAnchor | null>(initialAnchor);
  const initialAnchorRef = useRef<ReaderAnchor | null>(initialAnchor);
  const onPageChangeRef = useRef(onPageChange);
  const contentKeyRef = useRef(contentKey);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReadyRef = useRef(false);
  const layoutRef = useRef<(anchor: ReaderAnchor | null) => void>(() => {});
  const sizeRetryRef = useRef(0);

  useEffect(() => {
    initialAnchorRef.current = initialAnchor;
  }, [initialAnchor]);

  useEffect(() => {
    onPageChangeRef.current = onPageChange;
  }, [onPageChange]);

  const findSentence = useCallback(
    (sentenceId: string): HTMLElement | null => {
      const flow = flowRef.current;
      if (!flow) return null;
      return flow.querySelector<HTMLElement>(`[data-s="${escapeAttribute(sentenceId)}"]`);
    },
    [flowRef]
  );

  const rangeRectForAnchor = useCallback(
    (anchor: ReaderAnchor): DOMRect | null => {
      const element = findSentence(anchor.sentenceId);
      if (!element) return null;

      const node = element.firstChild;
      if (node && node.nodeType === Node.TEXT_NODE) {
        const length = node.textContent?.length ?? 0;
        if (length > 0) {
          const offset = clampCharOffset(anchor.charOffset, length);
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, Math.min(offset + 1, length));
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0 || rect.left > 0 || rect.top > 0) {
            return rect;
          }
        }
      }

      return element.getBoundingClientRect();
    },
    [findSentence]
  );

  /** Левый край последнего символа — честный конец текста без пустой колонки. */
  const lastCharLeft = useCallback((flow: HTMLElement): number => {
    const sentences = flow.querySelectorAll<HTMLElement>('[data-s]');
    for (let index = sentences.length - 1; index >= 0; index--) {
      const element = sentences[index];
      const node = element.lastChild;
      if (node && node.nodeType === Node.TEXT_NODE) {
        const length = node.textContent?.length ?? 0;
        if (length > 0) {
          const range = document.createRange();
          range.setStart(node, length - 1);
          range.setEnd(node, length);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0 || rect.left > 0 || rect.top > 0) {
            return rect.left;
          }
        }
      }

      const rect = element.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0 || rect.left > 0 || rect.top > 0) {
        return rect.left;
      }
    }

    // Глава без текста (только картинка или разделитель): конец считаем по
    // правому краю последнего визуального блока.
    const visualBlocks = flow.querySelectorAll<HTMLElement>('[data-block="image"], [data-block="separator"]');
    const lastVisual = visualBlocks.item(visualBlocks.length - 1);
    if (lastVisual) {
      return lastVisual.getBoundingClientRect().right - 1;
    }

    return flow.getBoundingClientRect().left;
  }, []);

  const captureAnchor = useCallback((): ReaderAnchor | null => {
    const viewport = viewportRef.current;
    const flow = flowRef.current;
    if (!viewport || !flow) return null;

    const viewportRect = viewport.getBoundingClientRect();
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (width <= 0 || height <= 0) return null;

    // Идём сверху вниз и слева направо: нужен первый видимый символ, а не
    // середина строки. Иначе после перевёрстки страница «съезжает» на пару
    // слов вперёд, хотя предложение формально то же.
    const maxY = Math.min(height - 4, 160);
    for (let y = 4; y <= maxY; y += 8) {
      for (let x = 4; x <= width - 4; x += 8) {
        const range = getCaretRange(viewportRect.left + x, viewportRect.top + y);
        if (!range) continue;
        const container = range.startContainer;
        const element =
          container.nodeType === Node.TEXT_NODE
            ? container.parentElement
            : container instanceof HTMLElement
              ? container
              : null;
        const sentence = element?.closest<HTMLElement>('[data-s]');
        if (!sentence?.dataset.s) continue;

        const text = sentence.textContent ?? '';
        return {
          sentenceId: sentence.dataset.s,
          charOffset: clampCharOffset(range.startOffset, text.length),
        };
      }
    }

    return firstVisibleSentence(
      viewportRect,
      flow.querySelectorAll<HTMLElement>('[data-s]')
    );
  }, [flowRef, viewportRef]);

  const emitAfterPaint = useCallback(
    (
      nextPage: number,
      total: number,
      delayMs: number,
      preferredAnchor: ReaderAnchor | null = null
    ) => {
      if (emitTimerRef.current) {
        clearTimeout(emitTimerRef.current);
      }

      emitTimerRef.current = setTimeout(() => {
        // Если снять якорь с экрана не удалось (перевёрстка ещё не отрисована),
        // держимся за последний известный: пустой якорь означает «место
        // потеряно» и на следующем открытии книгу начнёт с начала.
        const anchor = preferredAnchor ?? captureAnchor() ?? lastAnchorRef.current;
        lastAnchorRef.current = anchor;
        onPageChangeRef.current?.(nextPage, total, anchor);
      }, delayMs);
    },
    [captureAnchor]
  );

  const layout = useCallback(
    (anchor: ReaderAnchor | null) => {
      const viewport = viewportRef.current;
      const flow = flowRef.current;
      if (!viewport || !flow) return;

      // Дробная ширина важна: clientWidth округляет 327,625 до 328, и к
      // тридцать шестой странице накапливается больше десяти пикселей сдвига —
      // левый край текста начинает подрезаться. Колонка и шаг перелистывания
      // должны быть одной и той же измеренной величиной.
      const viewportRect = viewport.getBoundingClientRect();
      const width = viewportRect.width;
      const height = viewportRect.height;
      if (width <= 0 || height <= 0) {
        // Первый кадр до применения CSS: контейнер ещё без размера. Если
        // сдаться здесь, страница останется пустой навсегда — ResizeObserver
        // не обязан увидеть переход 0 → 548, если он случился до подписки.
        if (sizeRetryRef.current < 30) {
          sizeRetryRef.current += 1;
          requestAnimationFrame(() => layoutRef.current(anchor));
        }
        return;
      }

      sizeRetryRef.current = 0;

      flow.style.columnWidth = `${width}px`;
      flow.style.columnGap = '0px';
      flow.style.height = `${height}px`;
      flow.style.columnFill = 'auto';
      flow.style.transition = 'none';
      flow.style.transform = 'translate3d(0, 0, 0)';
      // Один принудительный reflow: без него браузер вернёт старую геометрию.
      void flow.offsetWidth;

      const flowRect = flow.getBoundingClientRect();
      const pageWidth = flowRect.width;
      if (pageWidth <= 0) return;

      const total = pageCountFromLastLeft(lastCharLeft(flow), flowRect.left, pageWidth);
      let nextPage = clampPage(pageRef.current, total);
      let anchorResolved = false;

      if (anchor) {
        const rect = rangeRectForAnchor(anchor);
        if (rect) {
          nextPage = clampPage(pageIndexFromLeft(rect.left, flowRect.left, pageWidth), total);
          anchorResolved = true;
        }
      }

      pageRef.current = nextPage;
      totalRef.current = total;
      setPage(nextPage);
      setTotalPages(total);
      flow.style.transform = `translate3d(${-nextPage * pageWidth}px, 0, 0)`;

      requestAnimationFrame(() => {
        flow.style.transition = '';
      });

      if (!isReadyRef.current) {
        isReadyRef.current = true;
        setIsReady(true);
      }

      // При перевёрстке не пересчитываем якорь по первой строке: страница
      // могла начаться на строку раньше, но читатель по-прежнему находится
      // в том же предложении. Сохраняем именно его.
      emitAfterPaint(nextPage, total, 0, anchorResolved ? anchor : null);
    },
    [emitAfterPaint, flowRef, lastCharLeft, rangeRectForAnchor, viewportRef]
  );

  layoutRef.current = layout;

  const goToPage = useCallback(
    (requestedPage: number) => {
      const viewport = viewportRef.current;
      const flow = flowRef.current;
      if (!viewport || !flow) return;

      const pageWidth = flow.getBoundingClientRect().width;
      if (pageWidth <= 0) return;

      const total = totalRef.current;
      const nextPage = clampPage(requestedPage, total);
      if (nextPage === pageRef.current) return;

      // Якорь снимаем до сдвига, а не после анимации. Иначе быстрый клик по
      // «A+» сразу после листания успевает переверстать страницу по старому
      // якорю, и читатель оказывается на пару абзацев дальше.
      const anchor = captureAnchor();
      if (anchor) {
        lastAnchorRef.current = anchor;
      }

      pageRef.current = nextPage;
      setPage(nextPage);
      flow.style.transition = '';
      flow.style.transform = `translate3d(${-nextPage * pageWidth}px, 0, 0)`;
      emitAfterPaint(nextPage, total, 240, anchor);
    },
    [captureAnchor, emitAfterPaint, flowRef, viewportRef]
  );

  const goToAnchor = useCallback(
    (anchor: ReaderAnchor) => {
      lastAnchorRef.current = anchor;
      layout(anchor);
    },
    [layout]
  );

  /**
   * Перелистнуть только если предложение вне страницы. Озвучка идёт по
   * предложениям, и полная перевёрстка на каждом из них — лишняя работа:
   * на странице их пять-семь, и все уже видны.
   */
  const ensureVisible = useCallback(
    (anchor: ReaderAnchor) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = rangeRectForAnchor(anchor);
      if (!rect) {
        layout(anchor);
        return;
      }

      const frame = viewport.getBoundingClientRect();
      const visible =
        rect.right > frame.left + 1 &&
        rect.left < frame.right - 1 &&
        rect.bottom > frame.top + 1 &&
        rect.top < frame.bottom - 1;

      if (!visible) {
        layout(anchor);
      }
    },
    [layout, rangeRectForAnchor, viewportRef]
  );

  const nextPage = useCallback(() => {
    goToPage(pageRef.current + 1);
  }, [goToPage]);

  const previousPage = useCallback(() => {
    goToPage(pageRef.current - 1);
  }, [goToPage]);

  // Первый layout и перевёрстка при смене главы/кегля/полей.
  useEffect(() => {
    let cancelled = false;

    if (contentKeyRef.current !== contentKey) {
      contentKeyRef.current = contentKey;
      lastAnchorRef.current = initialAnchorRef.current;
      pageRef.current = 0;
    }

    const run = async () => {
      // Ждать fonts.ready бесконечно нельзя: на холодной загрузке (dev-сервер
      // компилирует шрифты) промис может не разрешиться, и читалка останется
      // пустой навсегда. Ждём максимум 1,2 с, а когда шрифты всё-таки придут —
      // перемеряем ещё раз.
      try {
        await Promise.race([
          document.fonts?.ready ?? Promise.resolve(),
          new Promise((resolve) => setTimeout(resolve, 1200)),
        ]);
      } catch {
        // без Font Loading API просто измеряем то, что есть
      }
      if (cancelled) return;

      requestAnimationFrame(() => {
        if (cancelled) return;
        layout(lastAnchorRef.current);
      });

      document.fonts?.ready
        ?.then(() => {
          if (!cancelled) layoutRef.current(lastAnchorRef.current);
        })
        .catch(() => {
          // шрифты не загрузились — остаёмся на запасных метриках
        });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [contentKey, layout, layoutKey]);

  // Полная загрузка страницы (шрифты, CSS, картинки) — ещё один повод
  // перемерить: до неё браузер мог посчитать колонки по запасным метрикам.
  useEffect(() => {
    const remeasure = () => layoutRef.current(lastAnchorRef.current);
    window.addEventListener('load', remeasure);
    return () => window.removeEventListener('load', remeasure);
  }, []);

  // Поворот экрана и изменение размеров окна.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let lastWidth = viewport.clientWidth;
    let lastHeight = viewport.clientHeight;

    const schedule = () => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        const width = viewport.clientWidth;
        const height = viewport.clientHeight;
        if (width === lastWidth && height === lastHeight) return;
        lastWidth = width;
        lastHeight = height;
        layout(lastAnchorRef.current);
      }, 140);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);

    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', schedule);

    return () => {
      observer.disconnect();
      visualViewport?.removeEventListener('resize', schedule);
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
  }, [layout, viewportRef]);

  useEffect(() => {
    return () => {
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
  }, []);

  return {
    page,
    totalPages,
    isReady,
    captureAnchor,
    goToPage,
    goToAnchor,
    ensureVisible,
    nextPage,
    previousPage,
  };
}
