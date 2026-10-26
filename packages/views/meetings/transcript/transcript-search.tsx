import type { ReactNode } from "react";
import { foldVi } from "@uniwork/core/chat/search-fold";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * One rule for the transcript search, shared by its filter, its count and its
 * marks: a line matches when every word of `query` occurs in it, and every
 * occurrence of every word is marked. Folded Vietnamese-style ("hung" marks
 * "Hùng", "dau" marks "đầu"), each character on its own so a mark lands on the
 * original letters. Returns merged [start, end) ranges (a space between two
 * marks joins them), or null when some word
 * does not occur; an empty query matches with no ranges. `phrase` looks for
 * the words together, in order ("báo chí", not "báo" and "chí" anywhere).
 */
function searchTranscript(text: string, query: string, phrase: boolean): [number, number][] | null {
  const folded = foldVi(query).trim();
  const words = phrase ? [folded.replace(/\s+/g, " ")].filter(Boolean) : folded.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  let hay = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const piece = foldVi(text[i] ?? "");
    for (let j = 0; j < piece.length; j += 1) origin.push(i);
    hay += piece;
  }
  const found: [number, number][] = [];
  for (const word of words) {
    let seen = false;
    for (let at = hay.indexOf(word); at >= 0; at = hay.indexOf(word, at + 1)) {
      const start = origin[at] ?? 0;
      found.push([start, (origin[at + word.length - 1] ?? start) + 1]);
      seen = true;
    }
    if (!seen) return null;
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of found) {
    const prev = merged[merged.length - 1];
    // Words that overlap or stand a space apart read as one mark ("báo chí").
    if (prev && (start < prev[1] || /^\s+$/.test(text.slice(prev[1], start)))) prev[1] = Math.max(prev[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** True when every word of `query` (or, as a `phrase`, the words together) occurs in `text`: the filter and the count. */
export function transcriptLineMatches(text: string, query: string, phrase = false): boolean {
  return searchTranscript(text, query, phrase) !== null;
}

/** What to mark in a matching line; nothing in a line that does not match. */
export function transcriptMatches(text: string, query: string, phrase = false): [number, number][] {
  return searchTranscript(text, query, phrase) ?? [];
}

/**
 * Whether a search of several words reads as a phrase: when some line holds
 * them together, in order. Then only those lines count ("báo chí" finds the
 * press, not every line with "báo" and "chị"); otherwise each word may stand
 * anywhere in the line.
 */
export function transcriptPhraseSearch(texts: readonly string[], query: string): boolean {
  return /\s/.test(query.trim()) && texts.some((text) => transcriptLineMatches(text, query, true));
}

/**
 * The text with each match of `query` marked (kit `mark`); `active` rings the
 * marks of the hit the search is on (the "2/7" one).
 */
export function highlightTranscript(text: string, query: string, active = false, phrase = false): ReactNode {
  const ranges = transcriptMatches(text, query, phrase);
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  ranges.forEach(([start, end], i) => {
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <mark
        key={i}
        aria-current={active ? "true" : undefined}
        className={cn("rounded-xs bg-warning-soft px-0.5 whitespace-nowrap text-foreground", active && "outline-2 outline-ring")}
      >
        {text.slice(start, end)}
      </mark>,
    );
    last = end;
  });
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
