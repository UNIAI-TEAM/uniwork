import type { ReactNode } from "react";
import { foldVi } from "@uniwork/core/chat/search-fold";

/**
 * Every place `query` occurs in `text`, accent-insensitively ("hung" marks
 * "Hùng"), as [start, end) offsets into the original text. Each character is
 * folded on its own and keeps where it came from, so a mark lands on the
 * original letters.
 */
export function transcriptMatches(text: string, query: string): [number, number][] {
  const folded = foldVi(query.trim());
  if (!folded) return [];
  let hay = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const piece = foldVi(text[i] ?? "");
    for (let j = 0; j < piece.length; j += 1) origin.push(i);
    hay += piece;
  }
  const out: [number, number][] = [];
  for (let at = hay.indexOf(folded); at >= 0; at = hay.indexOf(folded, at + folded.length)) {
    const start = origin[at] ?? 0;
    out.push([start, (origin[at + folded.length - 1] ?? start) + 1]);
  }
  return out;
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
