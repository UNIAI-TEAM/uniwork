// Contract-first stand-in for the fork's `comments.viewVersion` (UNI-2033, T4 not released yet).
// `docs-frame-protocol.ts` is vendored and sha-pinned, so the request name, its payload and result,
// the validator and the capability name live here instead. The T6 re-vendor replaces this file:
// the types and the validator then come from the vendored protocol, and the host registers
// `"comments.viewVersion"` on its `api` map (see `useFrameComments`, `viewVersion`).

/** The frame asks the host to open version `version_no` read-only with `comment_id` revealed. */
export const VIEW_VERSION_REQUEST = "comments.viewVersion" as const;

/** Granted at `init` only when the host can answer the request (never inside a version view). */
export const VIEW_VERSION_CAPABILITY = "commentsViewVersion" as const;

export interface ViewVersionPayload {
  comment_id: string;
  version_no: number;
}

export interface ViewVersionResult {
  opened: boolean;
}

export function isViewVersionPayload(value: unknown): value is ViewVersionPayload {
  if (typeof value !== "object" || value === null) return false;
  const { comment_id: commentId, version_no: versionNo } = value as Record<string, unknown>;
  return typeof commentId === "string" && commentId !== "" && typeof versionNo === "number" && Number.isSafeInteger(versionNo) && versionNo > 0;
}

/** The capability entry a host adds to `init.capabilities`: absent inside a version view. */
export function viewVersionCapabilities(inVersionView: boolean): { commentsViewVersion?: true } {
  return inVersionView ? {} : { [VIEW_VERSION_CAPABILITY]: true };
}
