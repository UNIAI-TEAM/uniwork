"use client";

/**
 * Markdown find highlight — the SOURCE textarea half (M7).
 *
 * The Markdown source editor is a plain `<textarea>` (source-editor.tsx): its
 * content is not in the DOM as text nodes, so neither a ProseMirror decoration
 * nor the CSS Custom Highlight API can paint it. A textarea is highlighted the
 * only way a textarea can be:
 *
 *   1. `selectSourceMatch` moves the caret to the active match and scrolls it
 *      into view. It focuses the field only when the caller asks for it: the
 *      result-driven repaint fires on every keystroke while the panel is open,
 *      so focusing unconditionally would pull the caret out of the query box
 *      and type the next characters into the document.
 *   2. `MarkdownFindSourceHighlight` renders an overlay of the same text with
 *      every match wrapped in a `<mark>`, the active one carrying its own
 *      attribute. The consumer places it directly behind the textarea (same
 *      box, font, padding, wrap); the overlay's glyphs are transparent and only
 *      its marks paint a background, so the textarea stays the single source of
 *      the visible text and a mismatch cannot double the characters. It mirrors
 *      the field's scroll, so the marks stay on the lines they belong to.
 *
 * The ranges come from the shared S4 matcher (through the panel), never from a
 * second implementation.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { cn } from "@uniwork/ui/lib/utils";
import type { FindMatch } from "../../common/find";

export interface FindSourceSegment {
  readonly text: string;
  readonly kind: "plain" | "match" | "active";
}

/**
 * Split `text` into plain runs and match runs for the overlay. Matches are
 * already ordered and non-overlapping (the matcher's contract); a defensive
 * clamp keeps a stale range from slicing backwards.
 */
export function splitFindSegments(
  text: string,
  matches: readonly FindMatch[],
  activeIndex: number,
): FindSourceSegment[] {
  const segments: FindSourceSegment[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    const start = Math.max(match.start, cursor);
    const end = Math.min(match.end, text.length);
    if (end <= start) return;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), kind: "plain" });
    segments.push({ text: text.slice(start, end), kind: index === activeIndex ? "active" : "match" });
    cursor = end;
  });
  if (cursor < text.length) segments.push({ text: text.slice(cursor), kind: "plain" });
  return segments;
}

/**
 * Put the caret on a match and scroll it into view. Focus is the CALLER's
 * decision, never this function's: the result-driven repaint fires on every
 * source edit while the panel is open, and focusing the field there would move
 * the caret out of the query box mid-typing, so the next keystroke would land
 * in the document. Only an explicit navigation asks for `focus`.
 */
export function selectSourceMatch(
  textarea: HTMLTextAreaElement | null,
  match: FindMatch | null,
  focus = false,
): void {
  if (!textarea || !match) return;
  const start = Math.max(0, Math.min(match.start, textarea.value.length));
  const end = Math.max(start, Math.min(match.end, textarea.value.length));
  textarea.setSelectionRange(start, end);
  if (focus) textarea.focus({ preventScroll: true });
  scrollSourceMatchIntoView(textarea, start);
}

/** Scroll so the line holding `index` is visible, leaving a third above it. */
export function scrollSourceMatchIntoView(textarea: HTMLTextAreaElement, index: number): void {
  const viewport = textarea.clientHeight;
  if (viewport <= 0) return;
  const measured = Number.parseFloat(window.getComputedStyle(textarea).lineHeight);
  const lineHeight = Number.isFinite(measured) && measured > 0 ? measured : 20;
  const linesBefore = textarea.value.slice(0, index).split("\n").length - 1;
  const target = linesBefore * lineHeight;
  if (target < textarea.scrollTop || target > textarea.scrollTop + viewport - lineHeight) {
    textarea.scrollTop = Math.max(0, target - viewport / 3);
  }
}

/**
 * Keep the overlay's glyphs on the textarea's own lines. The overlay paints
 * from the document top while the textarea scrolls its content, so without
 * this every `<mark>` below the first viewport lands under the wrong line -
 * including right after `scrollSourceMatchIntoView` scrolls the field itself.
 * The overlay is `overflow-hidden`, so its `scrollTop` clips it exactly like
 * the textarea.
 */
function syncSourceHighlightScroll(
  textarea: HTMLTextAreaElement | null,
  overlay: HTMLElement | null,
): void {
  if (!textarea || !overlay) return;
  overlay.scrollTop = textarea.scrollTop;
  overlay.scrollLeft = textarea.scrollLeft;
}

export interface MarkdownFindSourceHighlightProps {
  text: string;
  matches: readonly FindMatch[];
  /** Index of the active match, or -1. */
  activeIndex: number;
  /** The textarea this overlay sits behind; its scroll offset is mirrored. */
  textarea?: HTMLTextAreaElement | null;
  /** Positioning/typography classes the consumer matches to its textarea. */
  className?: string;
  ref?: RefObject<HTMLDivElement | null>;
}

/**
 * The overlay itself. Rendered `aria-hidden`: the textarea already exposes the
 * text to assistive tech, and the marks are decoration. The consumer positions
 * it over the textarea (same font, padding and wrap) and keeps it behind.
 */
export function MarkdownFindSourceHighlight({
  text,
  matches,
  activeIndex,
  textarea = null,
  className,
  ref,
}: MarkdownFindSourceHighlightProps) {
  const segments = splitFindSegments(text, matches, activeIndex);
  const innerRef = useRef<HTMLDivElement | null>(null);
  // Mirror the field's scroll on mount and on every repaint (which is when the
  // selection scroll lands too), and keep mirroring it while the user scrolls.
  useEffect(() => {
    syncSourceHighlightScroll(textarea, innerRef.current);
    if (!textarea) return undefined;
    const onScroll = () => syncSourceHighlightScroll(textarea, innerRef.current);
    textarea.addEventListener("scroll", onScroll);
    return () => textarea.removeEventListener("scroll", onScroll);
  }, [activeIndex, matches, text, textarea]);
  // The host's `ref` and the local one share the node; the local ref is what
  // the scroll sync reads, so the mirror works whether or not a host passed one.
  const attachRef = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (ref) ref.current = node;
    },
    [ref],
  );
  return (
    <div
      ref={attachRef}
      aria-hidden
      data-testid="md-find-source-highlight"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent",
        className,
      )}
    >
      {segments.map((segment, index) =>
        segment.kind === "plain" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <mark
            key={index}
            data-find-match="1"
            data-find-active={segment.kind === "active" ? "1" : undefined}
            className={cn(
              "rounded-[2px] text-transparent",
              segment.kind === "active" ? "bg-brand" : "bg-warning-soft",
            )}
          >
            {segment.text}
          </mark>
        ),
      )}
    </div>
  );
}
