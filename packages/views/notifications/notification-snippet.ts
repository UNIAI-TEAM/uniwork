import type { Notification } from "@uniwork/core/types";
import { K } from "../documents/document-comments-keys";
import { documentChangedFacts, isDocumentChanged } from "./document-changed";
import { trashedOtherCount } from "./trashed-notice";

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

/** What a row says under its sentence. */
type NotificationSnippet =
  | { kind: "text"; text: string }
  | { kind: "deleted"; key: string }
  | { kind: "trashed"; document: string; count: number }
  | { kind: "documents"; titles: string[]; more: number }
  | null;

/**
 * The second line of a document comment row (S15). A document the recipient
 * can no longer read, or one that is gone, shows none (the server already
 * dropped the snippet; the row stays). A deleted comment says so by the kind
 * of post it was, and never shows what it said.
 */
export function notificationSnippet(n: Notification): NotificationSnippet {
  // A folded change row lists the sample titles the server already filtered to what the reader can read,
  // so the row-level access flags (about the first document only) do not apply. No titles: the sentence
  // carries the count and there is nothing to add, never an id.
  if (isDocumentChanged(n)) {
    const { titles, more } = documentChangedFacts(n);
    return titles.length > 0 ? { kind: "documents", titles, more } : null;
  }
  if (n.resource_type !== "document" || n.resource_access_lost || n.resource_deleted) return null;
  // A trash notice names the top item and how many others rode in its batch (TRASH-NOTIFY-01).
  if (n.kind === "document_trashed_by_other") {
    const document = n.params.document?.trim() ?? "";
    const count = trashedOtherCount(n.params);
    return document || count > 0 ? { kind: "trashed", document, count } : null;
  }
  if (n.comment_deleted) {
    return { kind: "deleted", key: n.params.kind === "discussion" ? K.collabDiscussionDeleted : K.collabCommentDeleted };
  }
  const text = plainSnippet(n.params.snippet ?? "");
  return text ? { kind: "text", text } : null;
}
