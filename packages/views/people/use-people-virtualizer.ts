"use client";

import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * The windowing both directory views share. A thousand-person company is the
 * size this product is built for (Vision §6.3), so once the scroll container
 * has been measured only the visible band of rows is rendered.
 *
 * Until it is measured — the first paint, a print, an environment with no
 * layout — every row is rendered instead. A zero-height measurement means "we
 * do not know what is visible", and showing nothing would read as an empty
 * directory.
 *
 * The window is expressed as two spacer heights rather than absolute
 * positioning, because the table view is a CSS subgrid: a row taken out of
 * flow would lose the column tracks its cells align to.
 */

const OVERSCAN = 6;

interface ViewportRect {
  width: number;
  height: number;
}

export interface ScrollViewport {
  /** The scroll container's box; `{0,0}` until it has been measured. */
  size: ViewportRect;
  /** Handed to the virtualizer so it reuses this hook's single observer. */
  observeElementRect: (
    instance: Virtualizer<HTMLDivElement, Element>,
    report: (rect: ViewportRect) => void,
  ) => void | (() => void);
}

/**
 * One ResizeObserver on the scroll container, shared by React and by the
 * virtualizer. The virtualizer would otherwise attach a second observer to the
 * same element, and a resize would then cost two measurement passes.
 *
 * Both consumers are reported to on attach rather than on the first observer
 * callback: reading the element's own box removes the blank frame between
 * mount and the first measurement.
 */
export function useScrollViewport(ref: RefObject<HTMLDivElement | null>): ScrollViewport {
  const [size, setSize] = useState<ViewportRect>({ width: 0, height: 0 });
  const listeners = useRef(new Set<(rect: ViewportRect) => void>());

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = { width: element.clientWidth, height: element.clientHeight };
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height ? prev : rect,
      );
      for (const report of listeners.current) report(rect);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  const observeElementRect = useCallback<ScrollViewport["observeElementRect"]>(
    (instance, report) => {
      const element = instance.scrollElement;
      if (!element) return;
      report({ width: element.clientWidth, height: element.clientHeight });
      const subscribers = listeners.current;
      subscribers.add(report);
      return () => subscribers.delete(report);
    },
    [],
  );

  return { size, observeElementRect };
}

export interface WindowedRows {
  /** False until the scroll container has a height; then every row renders. */
  virtualized: boolean;
  /** Row indexes to render, in order. */
  indexes: number[];
  /** Height of the spacer above the rendered band, in pixels. */
  paddingTop: number;
  /** Height of the spacer below the rendered band, in pixels. */
  paddingBottom: number;
  /** Last row index rendered — what drives paging. */
  lastRendered: number;
}

export function useWindowedRows({
  rowCount,
  rowHeight,
  scrollRef,
  viewport,
  scrollMargin = 0,
}: {
  rowCount: number;
  rowHeight: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  viewport: ScrollViewport;
  /** Height of whatever sits above the rows inside the same scroller. */
  scrollMargin?: number;
}): WindowedRows {
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    scrollMargin,
    observeElementRect: viewport.observeElementRect,
  });

  const items = virtualizer.getVirtualItems();
  if (viewport.size.height === 0 || items.length === 0) {
    return {
      virtualized: false,
      indexes: Array.from({ length: rowCount }, (_, i) => i),
      paddingTop: 0,
      paddingBottom: 0,
      lastRendered: rowCount - 1,
    };
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  return {
    virtualized: true,
    indexes: items.map((item) => item.index),
    paddingTop: first.start - scrollMargin,
    paddingBottom: virtualizer.getTotalSize() - (last.end - scrollMargin),
    lastRendered: last.index,
  };
}

/**
 * Ask for the next page once the last row is rendered. Paging is driven by the
 * scroll position rather than a button: the last rendered row asking for the
 * next page is what an infinite list means.
 */
export function useLoadMoreWhenAtEnd({
  lastRendered,
  total,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  lastRendered: number;
  total: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}): void {
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    if (lastRendered >= total - 1) onLoadMore();
  }, [hasNextPage, isFetchingNextPage, lastRendered, onLoadMore, total]);
}
