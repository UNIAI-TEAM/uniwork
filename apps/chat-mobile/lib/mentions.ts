// The phone's own reading of mention tokens: a stored body as runs of text and
// mentions, so a row draws the mentions apart without a markdown renderer.
// Writing tokens, the composer draft and the mention picker are core's
// (@uniwork/core/chat/chat-mention-utils), shared with the web.

export type MentionSegment = { text: string; mention?: "member" | "all"; userId?: string };

const MENTION_TOKEN = /\[@([^\]]+)\]\(mention:\/\/(member|all)\/([^)]+)\)/g;

/** A stored body as runs of text and mentions, so a row can draw the mentions apart. */
export function mentionSegments(body: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  let at = 0;
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const [token, label = "", kind, id] = match;
    if (match.index > at) out.push({ text: body.slice(at, match.index) });
    out.push(kind === "member" ? { text: `@${label}`, mention: "member", userId: id } : { text: `@${label}`, mention: "all" });
    at = match.index + token.length;
  }
  if (at < body.length) out.push({ text: body.slice(at) });
  return out;
}
