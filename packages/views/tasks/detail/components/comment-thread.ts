import type { TaskComment } from "@uniwork/core/types";

export type CommentThread = {
  root: TaskComment;
  replies: TaskComment[];
};

function byCreatedAt(a: TaskComment, b: TaskComment): number {
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

/**
 * Walks a comment's parent chain up to its top-level ancestor, so a reply of
 * a reply still lands one level deep under the thread it belongs to instead
 * of being dropped (the wire only allows one level in the UI, not in the data).
 *
 * Guarded against cycles (nonsense data — A's parent is B, B's parent is A —
 * must not hang the render): a `visited` set tracks every id seen in this
 * walk, and the moment the next hop would revisit one, the walk aborts and
 * the original comment falls back to being its own root, same as a comment
 * whose parent is missing. `steps` is capped at `comments.length` as a second,
 * independent bound in case some other shape of bad data slips past the
 * visited-set check.
 */
function resolveRootId(
  start: TaskComment,
  byId: Map<string, TaskComment>,
  ids: Set<string>,
  maxSteps: number,
): string {
  const visited = new Set<string>([start.id]);
  let current = start;
  let steps = 0;

  while (current.parent_id && ids.has(current.parent_id) && steps < maxSteps) {
    const parentId = current.parent_id;
    if (visited.has(parentId)) {
      return start.id;
    }
    const parent = byId.get(parentId);
    if (!parent) break;
    visited.add(parentId);
    current = parent;
    steps += 1;
  }

  return current.id;
}

/**
 * Flattened one level deep, which is what the UI renders. A reply whose
 * ancestor chain is broken — a missing parent, or a cycle — becomes a thread
 * of its own rather than vanishing: losing a person's words is worse than
 * showing them unrooted.
 */
export function buildCommentThreads(comments: TaskComment[]): CommentThread[] {
  const ids = new Set(comments.map((c) => c.id));
  const byId = new Map(comments.map((c) => [c.id, c] as const));
  const maxSteps = comments.length;

  const roots: TaskComment[] = [];
  const repliesByRoot = new Map<string, TaskComment[]>();

  for (const c of comments) {
    const rootId = resolveRootId(c, byId, ids, maxSteps);
    if (rootId === c.id) {
      roots.push(c);
      continue;
    }
    const list = repliesByRoot.get(rootId) ?? [];
    list.push(c);
    repliesByRoot.set(rootId, list);
  }

  return roots
    .slice()
    .sort(byCreatedAt)
    .map((root) => ({
      root,
      replies: (repliesByRoot.get(root.id) ?? []).slice().sort(byCreatedAt),
    }));
}
