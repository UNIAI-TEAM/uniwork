/**
 * Query-key factory for Documents. Every key carries `wsId` so invalidate
 * waves stay tenant-local, even though document ids are globally unique —
 * the detail answer is authorized for a member of that workspace, and a key
 * without it could hand one workspace's read to another context.
 *
 * `versions` is the 3-segment root for invalidate; the live infinite query
 * appends nothing (TanStack pages live inside one cache entry) and a
 * single-version read hangs off `version`/`versionNo`.
 */
export const documentKeys = {
  all: ["documents"] as const,
  workspace: (wsId: string) => [...documentKeys.all, wsId] as const,
  detail: (wsId: string, documentId: string) =>
    [...documentKeys.workspace(wsId), "doc", documentId] as const,
  versions: (wsId: string, documentId: string) =>
    [...documentKeys.detail(wsId, documentId), "versions"] as const,
  version: (wsId: string, documentId: string, versionNo: number) =>
    [...documentKeys.detail(wsId, documentId), "version", versionNo] as const,
  downloadMeta: (wsId: string, documentId: string, version?: number) =>
    [...documentKeys.detail(wsId, documentId), "download", version ?? 0] as const,
  /**
   * One page asset's bytes. Deliberately OUTSIDE the detail prefix: a
   * `document.*` realtime frame invalidates the detail key, and an image blob
   * must not be refetched — nor its object URL recreated — because a
   * collaborator typed a character.
   */
  asset: (wsId: string, documentId: string, assetId: string) =>
    [...documentKeys.all, wsId, "asset", documentId, assetId] as const,
  /** Placeholder key for a view that has no asset id yet; never fetched. */
  assetIdle: (wsId: string, documentId: string) =>
    [...documentKeys.all, wsId, "asset", documentId, "idle"] as const,
};
