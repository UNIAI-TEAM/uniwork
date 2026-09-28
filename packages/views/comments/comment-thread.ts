import type { CommentLike } from "./comment-types";

export type CommentThread<T extends CommentLike = CommentLike> = {
  root: T;
  replies: T[];
};

export type ThreadResolution =
  | { kind: "none" }
  | { kind: "root" }
  | { kind: "reply"; resolutionId: string };

export function deriveThreadResolution<T extends CommentLike>(
  root: T,
  replies: T[],
): ThreadResolution {
  if (root.resolved_at) return { kind: "root" };
  let chosen: T | null = null;
  for (const reply of replies) {
    if (!reply.resolved_at) continue;
    if (!chosen || reply.resolved_at > (chosen.resolved_at ?? "")) chosen = reply;
  }
  return chosen ? { kind: "reply", resolutionId: chosen.id } : { kind: "none" };
}

function byCreatedAt<T extends CommentLike>(a: T, b: T): number {
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
 *
 * Shared by task and document comments (G1-07c): the generic signature keeps
 * each surface's own DTO flowing through instead of widening it.
 */
function resolveRootId<T extends CommentLike>(
  start: T,
  byId: Map<string, T>,
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
export function buildCommentThreads<T extends CommentLike>(comments: T[]): CommentThread<T>[] {
  const ids = new Set(comments.map((c) => c.id));
  const byId = new Map(comments.map((c) => [c.id, c] as const));
  const maxSteps = comments.length;

  const roots: T[] = [];
  const repliesByRoot = new Map<string, T[]>();

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
