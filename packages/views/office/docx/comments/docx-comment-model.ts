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

/** The id of the comment that roots `id`'s thread: the topmost reachable
 * ancestor, whether it has no parent at all or its parent is missing from the
 * list (an orphan chain still renders as one thread). A parent cycle is not a
 * thread — every member degrades to its own root, so the entries stay visible.
 * Known ids without a parent return themselves. */
export function commentRootId(comments: readonly DocxCommentInfo[], id: string): string {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  let current = byId.get(id);
  const seen = new Set([id]);
  while (current?.parentId !== undefined) {
    const parent = byId.get(current.parentId);
    if (!parent) return current.id;
    if (seen.has(parent.id)) return id;
    seen.add(parent.id);
    current = parent;
  }
  return current?.id ?? id;
}

/** The ids a delete/resolve acts on: the comment plus its whole reply subtree,
 * transitively (files can carry replies to replies), cycle-safe. */
export function threadIds(comments: readonly DocxCommentInfo[], id: string): string[] {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const comment of comments) {
      if (comment.parentId !== undefined && ids.has(comment.parentId) && !ids.has(comment.id)) {
        ids.add(comment.id);
        grew = true;
      }
    }
  }
  return comments.filter((comment) => ids.has(comment.id)).map((comment) => comment.id);
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

/** Split the list into open and resolved threads. A reply attaches to its
 * chain root (replies to replies were invisible with a direct-children rule);
 * an entry whose chain has no root (missing parent, cycle) roots its own thread
 * so it stays visible instead of disappearing from every filter. */
export function groupCommentThreads(comments: readonly DocxCommentInfo[]): {
  open: DocxCommentThread[];
  resolved: DocxCommentThread[];
} {
  const roots = comments.filter((comment) => commentRootId(comments, comment.id) === comment.id);
  const threads = roots.map((comment) => ({
    id: comment.id,
    comment,
    replies: comments.filter((c) => c.id !== comment.id && commentRootId(comments, c.id) === comment.id),
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
