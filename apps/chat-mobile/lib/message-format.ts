// Ported from packages/views/chat/chat-message-body.tsx (URL_PATTERN, linkify,
// BOLD_PATTERN, formatText, renderMessageText): a message body as runs of
// text, links, **bold** and mentions, so a bubble draws its web addresses as
// links and its bold in bold, as the web does (audit UX P1 "no-linkify-markdown").
// Same patterns, same order (mentions first, then bold, then links inside
// both); the web returns React nodes, the phone a list a renderer and a screen
// reader's actions both read. message-format.test.ts runs the web's cases.
import { mentionSegments } from "./mentions";

export type BodySegment =
  | { kind: "text"; text: string; bold: boolean }
  | { kind: "link"; text: string; url: string; bold: boolean }
  | { kind: "mention"; text: string; mention: "member" | "all"; userId?: string };

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;
const BOLD_PATTERN = /\*\*([^*\n]+)\*\*/g;

/** Plain text with its web addresses made into links. */
function linkify(text: string, bold: boolean): BodySegment[] {
  const out: BodySegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start), bold });
    out.push({ kind: "link", text: match[0], url: match[0], bold });
    last = start + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last), bold });
  return out;
}

/** Linkified text with its **bold** spans set in bold. */
function formatText(text: string): BodySegment[] {
  const out: BodySegment[] = [];
  let last = 0;
  for (const match of text.matchAll(BOLD_PATTERN)) {
    const start = match.index;
    if (start > last) out.push(...linkify(text.slice(last, start), false));
    out.push(...linkify(String(match[1]), true));
    last = start + match[0].length;
  }
  if (last < text.length) out.push(...linkify(text.slice(last), false));
  return out;
}

/** A stored body as the runs a bubble draws: mentions apart, then bold and links in what is left. */
export function messageBodySegments(body: string): BodySegment[] {
  return mentionSegments(body).flatMap((segment): BodySegment[] =>
    segment.mention ? [{ kind: "mention", text: segment.text, mention: segment.mention, userId: segment.userId }] : formatText(segment.text),
  );
}

/** The distinct web addresses a body links to, in reading order (a screen reader's "open link" actions). */
export function messageLinks(body: string): string[] {
  const urls = messageBodySegments(body).flatMap((segment) => (segment.kind === "link" ? [segment.url] : []));
  return [...new Set(urls)];
}

/** A link named for a listener: its host and path without the scheme, e.g. "docs.example.com/a". */
export function spokenLink(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
