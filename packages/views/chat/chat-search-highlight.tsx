"use client";

import type { ReactNode } from "react";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";
import { foldVi } from "./chat-search-fold";

/**
 * The snippet with the match marked. The body is shown the way a person
 * reads it (mentions as @names, not markup), and matched accent-insensitively
 * — "tuan" marks "Tuấn" — by folding each character and keeping where it came
 * from, so the mark lands on the original letters.
 */
export function highlightSnippet(rawBody: string, query: string, maxLead?: number): ReactNode {
  const body = deserializeMessageBodyToComposerDraft(rawBody);
  const folded = foldVi(query.trim());
  if (!folded) return body;
  let hay = "";
  const origin: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const piece = foldVi(body[i] ?? "");
    for (let j = 0; j < piece.length; j += 1) origin.push(i);
    hay += piece;
  }
  const at = hay.indexOf(folded);
  if (at < 0) return body;
  const start = origin[at] ?? 0;
  const end = (origin[at + folded.length - 1] ?? start) + 1;
  // A one-line snippet keeps the match in view: past `maxLead` characters,
  // the start gives way to "…", cut where a word begins.
  const lead = body.slice(0, start);
  let before = lead;
  if (maxLead !== undefined && lead.length > maxLead) {
    const tail = lead.slice(-maxLead);
    const space = tail.indexOf(" ");
    before = `…${space >= 0 ? tail.slice(space + 1) : tail}`;
  }
  const match = body.slice(start, end);
  const after = body.slice(end);
  return (
    <>
      {before}
      <mark className="rounded-sm bg-tint-yellow px-0.5 font-semibold text-foreground">{match}</mark>
      {after}
    </>
  );
}

/** "16/10 10:05": the day, then the time (canvas), whatever order the locale prefers. */
export function formatResultTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // Vietnamese ICU writes "16-10"; the canvas (and every other chat date) uses a slash.
  const day = date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }).replace(/\D+/g, "/");
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
}
