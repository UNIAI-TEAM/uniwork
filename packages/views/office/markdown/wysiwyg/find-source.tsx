"use client";

/**
 * Markdown find highlight — the SOURCE textarea half (M7).
 *
 * The Markdown source editor is a plain `<textarea>` (source-editor.tsx): its
 * content is not in the DOM as text nodes, so neither a ProseMirror decoration
 * nor the CSS Custom Highlight API can paint it. A textarea is highlighted the
 * only way a textarea can be:
 *
 *   1. `selectSourceMatch` moves the caret to the active match and focuses the
 *      field, which scrolls it into view — the part that always works.
 *   2. `MarkdownFindSourceHighlight` renders an overlay of the same text with
 *      every match wrapped in a `<mark>`, the active one carrying its own
 *      attribute. The consumer places it directly behind the textarea (same
 *      box, font, padding, wrap); the overlay's glyphs are transparent and only
 *      its marks paint a background, so the textarea stays the single source of
 *      the visible text and a mismatch cannot double the characters.
 *
 * The ranges come from the shared S4 matcher (through the panel), never from a
 * second implementation.
 */
import type { RefObject } from "react";
import { cn } from "@uniwork/ui/lib/utils";
import type { FindMatch } from "../../common/find";

/** Same markers as the WYSIWYG decoration, so both modes read identically. */
export const SOURCE_FIND_MATCH_ATTRIBUTE = "data-find-match";
export const SOURCE_FIND_ACTIVE_ATTRIBUTE = "data-find-active";

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
 * Put the caret on a match and scroll it into view. Focus is what makes a real
 * browser scroll to the selection; the `scrollTop` nudge is the belt-and-braces
 * for the case where the field already had focus.
 */
export function selectSourceMatch(textarea: HTMLTextAreaElement | null, match: FindMatch | null): void {
  if (!textarea || !match) return;
  const start = Math.max(0, Math.min(match.start, textarea.value.length));
  const end = Math.max(start, Math.min(match.end, textarea.value.length));
  textarea.setSelectionRange(start, end);
  textarea.focus({ preventScroll: true });
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

export interface MarkdownFindSourceHighlightProps {
  text: string;
  matches: readonly FindMatch[];
  /** Index of the active match, or -1. */
  activeIndex: number;
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
  className,
  ref,
}: MarkdownFindSourceHighlightProps) {
  const segments = splitFindSegments(text, matches, activeIndex);
  return (
    <div
      ref={ref}
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
