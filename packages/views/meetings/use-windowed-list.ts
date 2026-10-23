"use client";
import { useCallback, useEffect, useState } from "react";

/** A list this long mounts only the rows near the viewport. */
const WINDOW_FROM_ROWS = 60;
const OVERSCAN_ROWS = 8;
const DEFAULT_ROW_PX = 52;
// A container that reports no height (hidden, or no layout yet) still gets a
// screenful of rows, so nothing reads as empty before the first measure.
const FALLBACK_VIEWPORT_PX = 640;

export type ListWindow = {
  start: number;
  end: number;
  /** Room for the rows above and below the window, so the scrollbar keeps the whole list's length. */
  padTop: number;
  padBottom: number;
};

/**
 * Which rows of a `count`-row list to mount, given its scroll container. Rows
 * are taken to share one height, read from the first row (`measureRow`);
 * a row that is a line taller only nudges the padding.
 */
export function listWindow(
  count: number,
  scrollTop: number,
  viewportPx: number,
  rowPx: number,
  overscan = OVERSCAN_ROWS,
): ListWindow {
  const row = rowPx > 0 ? rowPx : DEFAULT_ROW_PX;
  const viewport = viewportPx > 0 ? viewportPx : FALLBACK_VIEWPORT_PX;
  const start = Math.max(0, Math.min(count, Math.floor(scrollTop / row) - overscan));
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / row) + overscan);
  return { start, end: Math.max(start, end), padTop: start * row, padBottom: Math.max(0, count - end) * row };
}

/**
 * Windowing for a long list in its own scroll container: pass the container
 * through `scrollRef` and the first row through `measureRow`. Under
 * `WINDOW_FROM_ROWS` every row stays mounted, as before.
 */
export function useWindowedList(count: number): {
  window: ListWindow;
  windowed: boolean;
  scrollRef: (el: HTMLElement | null) => void;
  measureRow: (el: HTMLElement | null) => void;
} {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportPx, setViewportPx] = useState(0);
  const [rowPx, setRowPx] = useState(DEFAULT_ROW_PX);
  const windowed = count >= WINDOW_FROM_ROWS;

  useEffect(() => {
    if (!scrollEl || !windowed) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setScrollTop(scrollEl.scrollTop);
      setViewportPx(scrollEl.clientHeight);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(read);
    };
    read();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    observer?.observe(scrollEl);
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [scrollEl, windowed]);

  const measureRow = useCallback((el: HTMLElement | null) => {
    const height = el?.offsetHeight ?? 0;
    if (height > 0) setRowPx((prev) => (prev === height ? prev : height));
  }, []);

  return {
    window: windowed ? listWindow(count, scrollTop, viewportPx, rowPx) : { start: 0, end: count, padTop: 0, padBottom: 0 },
    windowed,
    scrollRef: setScrollEl,
    measureRow,
  };
}
