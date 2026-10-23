import type { ReactNode } from "react";
import { foldVi } from "@uniwork/core/chat/search-fold";

/**
 * One rule for the transcript search, shared by its filter, its count and its
 * marks: a line matches when every word of `query` occurs in it, and every
 * occurrence of every word is marked. Folded Vietnamese-style ("hung" marks
 * "Hùng", "dau" marks "đầu"), each character on its own so a mark lands on the
 * original letters. Returns merged [start, end) ranges, or null when some word
 * does not occur; an empty query matches with no ranges.
 */
function searchTranscript(text: string, query: string): [number, number][] | null {
  const words = foldVi(query).trim().split(/\s+/).filter(Boolean);
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
    if (prev && start < prev[1]) prev[1] = Math.max(prev[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** True when every word of `query` occurs in `text` (the filter and the count). */
export function transcriptLineMatches(text: string, query: string): boolean {
  return searchTranscript(text, query) !== null;
}

/** What to mark in a matching line; nothing in a line that does not match. */
export function transcriptMatches(text: string, query: string): [number, number][] {
  return searchTranscript(text, query) ?? [];
}

/** The text with each match of `query` marked. */
export function highlightTranscript(text: string, query: string): ReactNode {
  const ranges = transcriptMatches(text, query);
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  ranges.forEach(([start, end], i) => {
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <mark key={i} className="rounded-sm bg-tint-yellow px-0.5 text-foreground">
        {text.slice(start, end)}
      </mark>,
    );
    last = end;
  });
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
