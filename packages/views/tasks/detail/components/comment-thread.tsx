"use client";

import type { TaskComment } from "@uniwork/core/types";

export type CommentThread = {
  root: TaskComment;
  replies: TaskComment[];
};

function byCreatedAt(a: TaskComment, b: TaskComment): number {
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

/**
 * One level deep, which is what the data model allows. A reply whose parent is
 * missing — deleted, or not in this page — becomes a thread of its own rather
 * than vanishing: losing a person's words is worse than showing them unrooted.
 */
export function buildCommentThreads(comments: TaskComment[]): CommentThread[] {
  const ids = new Set(comments.map((c) => c.id));
  const roots = comments.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  const repliesByParent = new Map<string, TaskComment[]>();

  for (const c of comments) {
    if (!c.parent_id || !ids.has(c.parent_id)) continue;
    const list = repliesByParent.get(c.parent_id) ?? [];
    list.push(c);
    repliesByParent.set(c.parent_id, list);
  }

  return roots
    .slice()
    .sort(byCreatedAt)
    .map((root) => ({
      root,
      replies: (repliesByParent.get(root.id) ?? []).slice().sort(byCreatedAt),
    }));
}
