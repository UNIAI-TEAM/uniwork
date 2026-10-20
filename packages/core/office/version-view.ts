import type { CommentsViewVersionPayload, CommentsViewVersionResult } from "./docs-frame-protocol";

// The D half of "open a document version read-only" (UNI-2033): the page's `?version=N` parameter,
// the hrefs that carry it, the lost-comment reader the Inbox landing uses, and the host's answer to
// the frame's `comments.viewVersion`.

/** `?version=`: a positive safe integer, written in plain digits; anything else is ignored. */
export function parseVersionParam(raw: string | null | undefined): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** The page URL of version `versionNo`, with `commentId` revealed when there is one. */
export function versionViewHref(pathname: string, versionNo: number, commentId?: string | null): string {
  return `${pathname}?version=${versionNo}${commentId ? `&comment=${encodeURIComponent(commentId)}` : ""}`;
}

/** The page URL of the current version: `version` dropped, `comment` kept. */
export function currentVersionHref(pathname: string, commentId?: string | null): string {
  return commentId ? `${pathname}?comment=${encodeURIComponent(commentId)}` : pathname;
}

/**
 * The version a `comments.list` answer says comment `commentId` was last anchored on, when that
 * comment is `lost` and the server named the number; anything else (another state, a missing or
 * drifted number, a list that is not one) is null and the caller does nothing.
 */
export function lostCommentVersion(list: unknown, commentId: string): number | null {
  const comments = typeof list === "object" && list !== null ? (list as { comments?: unknown }).comments : undefined;
  if (!Array.isArray(comments)) return null;
  for (const comment of comments as unknown[]) {
    if (typeof comment !== "object" || comment === null) continue;
    const row = comment as { id?: unknown; anchor_state?: unknown; anchor_version_no?: unknown };
    if (row.id !== commentId) continue;
    return row.anchor_state === "lost" ? parseVersionParam(typeof row.anchor_version_no === "number" ? String(row.anchor_version_no) : null) : null;
  }
  return null;
}

/**
 * The host's answer to `comments.viewVersion`: one history entry to the version URL, then
 * `{ opened: true }` (the page remounts the frame as a read-only version view). The vendored
 * endpoint has already refused a payload without a comment id and a positive `version_no`.
 */
export function createViewVersionHandler(go: (href: string) => void, pathname: () => string): (payload: CommentsViewVersionPayload) => CommentsViewVersionResult {
  return (payload) => {
    go(versionViewHref(pathname(), payload.version_no, payload.comment_id));
    return { opened: true };
  };
}
