"use client";

// UNI-924 T7 (M-1 / C10): the page x/y readout the status bar mirrors. The
// editing handle keeps the paginator private, so the page boundaries are read
// from the DOM the pagination driver paints: one `.page-gap` widget per page
// turn (the same selector upstream's `pageFramesFromGaps` walks). Nothing here
// mutates the surface.

export interface DocxPagePosition {
  current: number;
  total: number;
}

/**
 * Page frames inside one scroll viewport. The widget selector matches the
 * renderer: carry spacers are not page turns, a table cut marker is.
 */
export function docxPageFrameSelector(): string {
  return ".page-gap:not(.page-gap-carry), .page-gap-cut";
}

/**
 * The visible page and the page count for the surface inside `scrollElement`.
 * Returns null when no paginated surface is mounted (the bar then keeps its
 * unknown mark). The current page is the last boundary the viewport top has
 * passed, so scrolling to the next page advances the readout.
 */
export function readDocxPagePosition(scrollElement: HTMLElement | null | undefined): DocxPagePosition | null {
  if (!scrollElement || typeof scrollElement.querySelector !== "function") return null;
  const wrap = scrollElement.querySelector(".page-wrap");
  if (!wrap) return null;
  const gaps = Array.from(wrap.querySelectorAll<HTMLElement>(docxPageFrameSelector()));
  const total = gaps.length + 1;
  let current = 1;
  try {
    const viewportTop = scrollElement.getBoundingClientRect().top;
    for (const gap of gaps) {
      if (gap.getBoundingClientRect().top <= viewportTop) current += 1;
      else break;
    }
  } catch {
    current = 1;
  }
  return { current: Math.min(current, total), total };
}
