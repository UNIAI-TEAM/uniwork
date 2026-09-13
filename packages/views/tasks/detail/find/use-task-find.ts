"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// ---------------------------------------------------------------------------
// In-page find for the task detail page.
//
// Matches are painted with the CSS Custom Highlight API: ranges only, never DOM
// mutation, so it works over rendered markdown and the contenteditable title
// and description editors without fighting ProseMirror. The task timeline is
// not virtualized, so there is no flat-render mode; the one thing kept out of
// the DOM is a collapsed resolved thread, which the timeline opens for the
// current query (find-expanded-threads.ts). The keyboard shortcut lives in
// hooks/use-task-detail-shortcuts.ts.
// ---------------------------------------------------------------------------

const HIGHLIGHT_NAME = "task-find";
const ACTIVE_HIGHLIGHT_NAME = "task-find-active";

// Evaluated per render. Without the API the bar still opens, counts and
// navigates; it just paints no tint. Guards `CSS`/`Highlight` for SSR too.
function highlightApiSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
  );
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
// The find bar marks itself `data-find-ignore`. A `hidden` subtree (the
// collapsed sub-task list stays mounted) is text nobody can see.
const SKIP_SUBTREE_SELECTOR = "[data-find-ignore], [hidden]";

export interface TextMatch {
  node: Text;
  start: number;
  end: number;
}

/**
 * Every case-insensitive occurrence of `query` in the text nodes under `root`,
 * in document order. A match never straddles an element boundary (a query
 * across a bold run is not found), the usual trade-off for lightweight find.
 */
export function collectTextMatches(root: HTMLElement, query: string): TextMatch[] {
  const matches: TextMatch[] = [];
  const needle = query.toLowerCase();
  if (!needle) return matches;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(SKIP_SUBTREE_SELECTOR)) return NodeFilter.FILTER_REJECT;
      const value = node.nodeValue;
      if (!value || value.trim().length === 0) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const haystack = (textNode.nodeValue ?? "").toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      matches.push({ node: textNode, start: index, end: index + needle.length });
      index = haystack.indexOf(needle, index + needle.length);
    }
  }

  return matches;
}

/**
 * Bring `range` into view by driving the scroll container's `scrollTop`.
 * Never native `scrollIntoView`: it scrolls every scrollable ancestor up to
 * the window, shoving the shell around. Only scrolls when the match is
 * outside the comfortable band of the viewport.
 */
function scrollRangeIntoView(container: HTMLElement | null, range: Range): void {
  if (!container) return;
  const rects = range.getClientRects();
  const rect = rects.length > 0 ? rects[0]! : range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  const containerRect = container.getBoundingClientRect();
  const pad = 80;
  const above = rect.top < containerRect.top + pad;
  const below = rect.bottom > containerRect.bottom - pad;
  if (!above && !below) return;

  const offsetWithin = rect.top - containerRect.top + container.scrollTop;
  const target = offsetWithin - container.clientHeight / 2 + rect.height / 2;
  container.scrollTop = Math.max(0, target);
}

export interface TaskFindState {
  open: boolean;
  query: string;
  /** Total number of matches for the current query. */
  matchCount: number;
  /** 0-based index of the active match, or -1 when there are none. */
  activeIndex: number;
  /** Whether the CSS Custom Highlight API is available in this browser. */
  supported: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  /** The bar's root: focus inside it is handed back when the bar closes. */
  barRef: RefObject<HTMLDivElement | null>;
  setQuery: (value: string) => void;
  openFind: () => void;
  closeFind: () => void;
  goNext: () => void;
  goPrev: () => void;
}

export function useTaskFind(options: {
  /** The scroll container whose text is searched. */
  container: HTMLElement | null;
  /** Changes whenever searchable content changes; re-walks the page. */
  contentKey: unknown;
}): TaskFindState {
  const { container, contentKey } = options;

  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focusRequest, setFocusRequest] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const rangesRef = useRef<Range[]>([]);
  // Mirrors `activeIndex` for callbacks that must read it without re-creating.
  const activeIndexRef = useRef(-1);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const supported = highlightApiSupported();

  const setActive = useCallback((index: number) => {
    activeIndexRef.current = index;
    setActiveIndex(index);
  }, []);

  const clearHighlights = useCallback(() => {
    if (!supported) return;
    CSS.highlights.delete(HIGHLIGHT_NAME);
    CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
  }, [supported]);

  // Paint the active match over the all-matches tint and, when asked, bring
  // it into view. Tracking and scrolling work without the Highlight API;
  // only the paint depends on it.
  const applyActive = useCallback(
    (index: number, scroll: boolean) => {
      const range = index >= 0 ? rangesRef.current[index] : undefined;
      if (supported) {
        if (range) {
          const active = new Highlight(range);
          active.priority = 1;
          CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, active);
        } else {
          CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
        }
      }
      if (range && scroll) scrollRangeIntoView(container, range);
    },
    [supported, container],
  );

  // Rebuild the matches from the live DOM. `resetActive` restarts at the first
  // match (query changed); otherwise the active index survives content
  // shifting underneath (a new comment, a re-render).
  const recompute = useCallback(
    (resetActive: boolean) => {
      if (!open || !container || query.trim().length === 0) {
        rangesRef.current = [];
        clearHighlights();
        setMatchCount(0);
        setActive(-1);
        return;
      }

      const ranges = collectTextMatches(container, query).map((match) => {
        const range = new Range();
        range.setStart(match.node, match.start);
        range.setEnd(match.node, match.end);
        return range;
      });
      rangesRef.current = ranges;

      if (ranges.length === 0) {
        clearHighlights();
        setMatchCount(0);
        setActive(-1);
        return;
      }

      if (supported) {
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
      }
      setMatchCount(ranges.length);
      const previous = activeIndexRef.current;
      const next =
        resetActive || previous < 0 ? 0 : Math.min(previous, ranges.length - 1);
      setActive(next);
      // Scroll only for a new query; never yank the view while content
      // changes under a fixed active match.
      applyActive(next, resetActive);
    },
    [open, container, query, supported, clearHighlights, setActive, applyActive],
  );

  // Open/close or a new query: restart at the first match one frame later,
  // after the timeline has committed the resolved threads this query opens.
  useEffect(() => {
    const frame = requestAnimationFrame(() => recompute(true));
    return () => cancelAnimationFrame(frame);
  }, [recompute]);

  // Searchable content changed: re-walk, keeping the active match.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => recompute(false));
    return () => cancelAnimationFrame(frame);
  }, [contentKey, open, recompute]);

  // Async DOM churn (rich content settling, an editor re-rendering) replaces
  // text nodes and invalidates the ranges; coalesce bursts into one frame.
  useEffect(() => {
    if (!open || !container) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => recompute(false));
    });
    observer.observe(container, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, container, recompute]);

  // Stepping between matches moves the active tint and scrolls to it.
  useEffect(() => {
    if (!open) return;
    applyActive(activeIndex, true);
  }, [activeIndex, open, applyActive]);

  // Every open (including ⌘F again while open) focuses and selects the query.
  useEffect(() => {
    if (focusRequest === 0) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusRequest]);

  // Drop highlights on unmount so a stale tint cannot outlive the page.
  useEffect(() => clearHighlights, [clearHighlights]);

  const setQuery = useCallback((value: string) => setQueryState(value), []);

  const openFind = useCallback(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !barRef.current?.contains(active)
    ) {
      restoreFocusRef.current = active;
    }
    setOpen(true);
    setFocusRequest((request) => request + 1);
  }, []);

  const closeFind = useCallback(() => {
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    // Hand focus back only when it is in the bar (Escape, the close button).
    // A close for another reason (the task changed) leaves focus alone.
    const focusInBar = !!barRef.current?.contains(document.activeElement);
    setOpen(false);
    if (focusInBar && restore?.isConnected) restore.focus();
  }, []);

  const goNext = useCallback(() => {
    const total = rangesRef.current.length;
    const previous = activeIndexRef.current;
    setActive(total === 0 ? -1 : previous < 0 ? 0 : (previous + 1) % total);
  }, [setActive]);

  const goPrev = useCallback(() => {
    const total = rangesRef.current.length;
    const previous = activeIndexRef.current;
    setActive(total === 0 ? -1 : previous < 0 ? total - 1 : (previous - 1 + total) % total);
  }, [setActive]);

  return {
    open,
    query,
    matchCount,
    activeIndex,
    supported,
    inputRef,
    barRef,
    setQuery,
    openFind,
    closeFind,
    goNext,
    goPrev,
  };
}
