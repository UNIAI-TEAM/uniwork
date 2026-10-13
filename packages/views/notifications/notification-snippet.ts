import type { Notification } from "@uniwork/core/types";
import { K } from "../documents/document-comments-keys";

// The mention token of the comment body (contract-collab §4.2), and the same
// token cut by the server's snippet bound (the snippet ends in "…").
const MENTION = /\[@((?:[^[\]\\]|\\.)*)\]\(mention:\/\/member\/[0-9A-Za-z]{26}\)/g;
// A lone backslash before the cut is the start of an escape the bound split in two.
const CUT_MENTION = /\[@((?:[^[\]\\\n]|\\.)*)\\?(?:\](?:\([^)\s]*)?)?…$/;

/** `\[`, `\]`, `\(`, `\)` and `\\` in a token label are Markdown escapes. */
const unescapeLabel = (label: string) => label.replace(/\\(.)/g, "$1");

/**
 * A comment snippet as one plain line: every mention token reads as the name
 * written in it ("@An"), never as raw `[@An](mention://member/…)` markup, and
 * a token the snippet bound cut in half still reads as a name.
 */
export function plainSnippet(raw: string): string {
  return raw
    .replace(MENTION, (_, label: string) => `@${unescapeLabel(label)}`)
    .replace(CUT_MENTION, (_, label: string) => `@${unescapeLabel(label)}…`)
    .replace(/\s+/g, " ")
    .trim();
}

/** What a document row says under its sentence. */
type NotificationSnippet = { kind: "text"; text: string } | { kind: "deleted"; key: string } | null;

/**
 * The second line of a document comment row (S15). A document the recipient
 * can no longer read, or one that is gone, shows none (the server already
 * dropped the snippet; the row stays). A deleted comment says so by the kind
 * of post it was, and never shows what it said.
 */
export function notificationSnippet(n: Notification): NotificationSnippet {
  if (n.resource_type !== "document" || n.resource_access_lost || n.resource_deleted) return null;
  if (n.comment_deleted) {
    return { kind: "deleted", key: n.params.kind === "discussion" ? K.collabDiscussionDeleted : K.collabCommentDeleted };
  }
  const text = plainSnippet(n.params.snippet ?? "");
  return text ? { kind: "text", text } : null;
}
