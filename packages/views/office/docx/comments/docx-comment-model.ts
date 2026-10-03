// Comment thread rules for the DOCX review pane — pure helpers only, so the
// controller (comments/docx-comments-controller.ts) owns every state change and
// the panel renders what it is told. Word semantics: a thread is a top-level
// comment plus its replies, and delete/resolve act on the whole thread.
import type { DocxCommentInfo } from "@uniwork/office-engine/docx";

/** A thread: one top-level comment with its replies, in file order. */
export interface DocxCommentThread {
  id: string;
  comment: DocxCommentInfo;
  replies: DocxCommentInfo[];
}

/** Smallest unused numeric comment id — Word-compatible numeric ids, matching
 * the upstream nextCommentId contract (editor/comments.ts:13). */
export function nextCommentId(comments: readonly DocxCommentInfo[]): string {
  const max = comments.reduce((acc, comment) => Math.max(acc, Number.parseInt(comment.id, 10) || 0), 0);
  return String(max + 1);
}

/** The ids a delete/resolve acts on: the comment plus its direct replies. */
export function threadIds(comments: readonly DocxCommentInfo[], id: string): string[] {
  return [id, ...comments.filter((comment) => comment.parentId === id).map((comment) => comment.id)];
}

/** Resolve/reopen a whole thread (Word sets the flag on every entry). */
export function applyThreadResolved(
  comments: readonly DocxCommentInfo[],
  id: string,
  done: boolean,
): DocxCommentInfo[] {
  const ids = new Set(threadIds(comments, id));
  return comments.map((comment) => (ids.has(comment.id) ? { ...comment, done } : comment));
}

/** Drop a thread: the comment and its replies. */
export function removeThread(comments: readonly DocxCommentInfo[], id: string): DocxCommentInfo[] {
  const ids = new Set(threadIds(comments, id));
  return comments.filter((comment) => !ids.has(comment.id));
}

/** Split the list into open and resolved threads (reply-only entries never
 * stand alone — an orphan reply degrades into its own thread so it stays
 * visible instead of disappearing from every filter). */
export function groupCommentThreads(comments: readonly DocxCommentInfo[]): {
  open: DocxCommentThread[];
  resolved: DocxCommentThread[];
} {
  const ids = new Set(comments.map((comment) => comment.id));
  const roots = comments.filter((comment) => comment.parentId === undefined || !ids.has(comment.parentId));
  const threads = roots.map((comment) => ({
    id: comment.id,
    comment,
    replies: comments.filter((c) => c.parentId === comment.id),
  }));
  return {
    open: threads.filter((thread) => thread.comment.done !== true),
    resolved: threads.filter((thread) => thread.comment.done === true),
  };
}

/** ISO timestamp for a new entry, seconds precision (upstream writes this
 * shape into w:date). */
export function commentTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Display form of a w:date; empty for absent/unparsable values. */
export function formatCommentDate(date: string | undefined, locale: string | undefined): string {
  if (!date) return "";
  const time = Date.parse(date);
  if (Number.isNaN(time)) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(time);
  } catch {
    return new Date(time).toLocaleString();
  }
}

/** Two-letter avatar text from the author (or initials when the file has them). */
export function commentInitials(comment: Pick<DocxCommentInfo, "author" | "initials">): string {
  const source = (comment.initials ?? comment.author ?? "").trim();
  if (!source) return "?";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
