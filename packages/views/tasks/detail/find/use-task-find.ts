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

/**
 * The form both sides of a find comparison are brought to: canonical
 * composition (NFC), then lowercase. Vietnamese text reaches the page either
 * composed or decomposed (a base letter followed by combining marks, common in
 * text pasted from macOS files); without folding, a query typed on a keyboard
 * misses decomposed text that looks identical.
 */
export function foldForFind(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

// One base character with the combining marks that follow it, or a run of
// marks with no base. Canonical composition only joins a base with its own
// marks, so folding unit by unit keeps a map back to the original offsets.
// (Conjoining Hangul jamo compose without marks and stay unfolded.)
const COMBINING_UNIT = /\P{M}\p{M}*|\p{M}+/gu;

interface FoldedText {
  text: string;
  /**
   * For each code unit of `text`, the original start and end offsets of the
   * unit it came from. `null` when folding kept every offset.
   */
  starts: number[] | null;
  ends: number[] | null;
}

function foldByUnit(raw: string, lowerEachUnit: boolean): FoldedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  // The units tile the string: every code point is a mark or it is not.
  for (const [unit] of raw.matchAll(COMBINING_UNIT)) {
    const start = offset;
    offset += unit.length;
    const composed = unit.normalize("NFC");
    const piece = lowerEachUnit ? composed.toLowerCase() : composed;
    text += piece;
    for (let i = 0; i < piece.length; i += 1) {
      starts.push(start);
      ends.push(offset);
    }
  }
  return { text, starts, ends };
}

function foldTextNode(raw: string): FoldedText {
  // Already composed and lowercasing keeps the length: offsets are unchanged.
  // (The only length-changing lowercase mapping expands, never shrinks.)
  if (raw.normalize("NFC") === raw) {
    const text = raw.toLowerCase();
    if (text.length === raw.length) return { text, starts: null, ends: null };
  }
  const composed = foldByUnit(raw, false);
  const text = composed.text.toLowerCase();
  if (text.length === composed.text.length) return { ...composed, text };
  // A lowercase mapping that changes length (U+0130): lowercase each unit so
  // the offset map stays exact.
  return foldByUnit(raw, true);
}

export interface TextMatch {
  node: Text;
  start: number;
  end: number;
}

/**
 * Every occurrence of `query` in the text nodes under `root`, in document
 * order, compared after `foldForFind` on both sides. Offsets point into the
 * original node text: a match that starts or ends inside a base-plus-marks
 * unit widens to the whole unit, so a highlight never splits a letter from its
 * accents. A match never straddles an element boundary (a query across a bold
 * run is not found), the usual trade-off for lightweight find.
 */
export function collectTextMatches(root: HTMLElement, query: string): TextMatch[] {
  const matches: TextMatch[] = [];
  const needle = foldForFind(query);
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
    const folded = foldTextNode(textNode.nodeValue ?? "");
    let index = folded.text.indexOf(needle);
    while (index !== -1) {
      const last = index + needle.length - 1;
      matches.push({
        node: textNode,
        start: folded.starts ? folded.starts[index]! : index,
        end: folded.ends ? folded.ends[last]! : index + needle.length,
      });
      index = folded.text.indexOf(needle, index + needle.length);
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

/** Quiet period after the last keystroke before the page is walked again. */
const QUERY_DEBOUNCE_MS = 150;

export interface TaskFindState {
  open: boolean;
  query: string;
  /** Total number of matches from the last walk of the page. */
  matchCount: number;
  /** 0-based index of the active match, or -1 when there are none. */
  activeIndex: number;
  /** The query changed and the page has not been walked for it yet. */
  pending: boolean;
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

interface PendingWalk {
  timer: ReturnType<typeof setTimeout>;
  resetActive: boolean;
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
  // The query the current matches were computed for; "" when there are none.
  const [walkedQuery, setWalkedQuery] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const rangesRef = useRef<Range[]>([]);
  // Mirrors `activeIndex` for callbacks that must read it without re-creating.
  const activeIndexRef = useRef(-1);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef<PendingWalk | null>(null);
  const lastQueryRef = useRef(query);
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
        setWalkedQuery("");
        return;
      }

      const ranges = collectTextMatches(container, query).map((match) => {
        const range = new Range();
        range.setStart(match.node, match.start);
        range.setEnd(match.node, match.end);
        return range;
      });
      rangesRef.current = ranges;
      setWalkedQuery(query);

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

  // Timers read the newest recompute, whichever render scheduled them.
  // Declared before the effects that schedule, so it is current when they run.
  const recomputeRef = useRef(recompute);
  useEffect(() => {
    recomputeRef.current = recompute;
  }, [recompute]);

  // At most one walk is pending. A content change never cuts short a new
  // query still waiting out its debounce: that walk sees the newest content.
  const schedule = useCallback((resetActive: boolean, delayMs: number) => {
    const previous = pendingRef.current;
    if (previous?.resetActive && !resetActive) return;
    if (previous) clearTimeout(previous.timer);
    const merged = resetActive || !!previous?.resetActive;
    pendingRef.current = {
      resetActive: merged,
      timer: setTimeout(() => {
        pendingRef.current = null;
        recomputeRef.current(merged);
      }, delayMs),
    };
  }, []);

  // Run a pending walk now, so stepping never acts on the previous query's matches.
  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    recomputeRef.current(pending.resetActive);
  }, []);

  // Open/close, a new container or a new query: walk again from the first
  // match. A new query while the bar is open waits out the debounce, so typing
  // walks the page once, not once per keystroke. Everything else runs on the
  // next tick, after the timeline has committed the resolved threads it opens.
  useEffect(() => {
    const queryChanged = lastQueryRef.current !== query;
    lastQueryRef.current = query;
    schedule(true, open && queryChanged ? QUERY_DEBOUNCE_MS : 0);
  }, [open, query, container, schedule]);

  // Searchable content changed: walk again, keeping the active match.
  useEffect(() => {
    if (!open) return;
    schedule(false, 0);
  }, [contentKey, open, schedule]);

  // Async DOM churn (rich content settling, an editor re-rendering) replaces
  // text nodes and invalidates the ranges; a burst coalesces into one walk.
  useEffect(() => {
    if (!open || !container) return;
    const observer = new MutationObserver(() => schedule(false, 0));
    observer.observe(container, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [open, container, schedule]);

  // A walk must not land (and paint highlights) after the page has gone.
  useEffect(
    () => () => {
      const pending = pendingRef.current;
      if (pending) clearTimeout(pending.timer);
      pendingRef.current = null;
    },
    [],
  );

  // Stepping between matches moves the active tint and scrolls to it.
  useEffect(() => {
    if (!open) return;
    applyActive(activeIndex, true);
  }, [activeIndex, open, applyActive]);

  // Every open (including ⌘F again while open) focuses and selects the query.
  // TipTap may reclaim focus on the same tick after a title/description ready
  // callback; one animation frame is enough for the find input to win.
  useEffect(() => {
    if (focusRequest === 0) return;
    const input = inputRef.current;
    if (!input) return;
    const raf = requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return () => cancelAnimationFrame(raf);
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
    flush();
    const total = rangesRef.current.length;
    const previous = activeIndexRef.current;
    setActive(total === 0 ? -1 : previous < 0 ? 0 : (previous + 1) % total);
  }, [flush, setActive]);

  const goPrev = useCallback(() => {
    flush();
    const total = rangesRef.current.length;
    const previous = activeIndexRef.current;
    setActive(total === 0 ? -1 : previous < 0 ? total - 1 : (previous - 1 + total) % total);
  }, [flush, setActive]);

  return {
    open,
    query,
    matchCount,
    activeIndex,
    pending: open && query.trim().length > 0 && walkedQuery !== query,
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
