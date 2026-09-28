/**
 * Query-key factory for Documents. Every key carries `wsId` so invalidate
 * waves stay tenant-local, even though document ids are globally unique —
 * the detail answer is authorized for a member of that workspace, and a key
 * without it could hand one workspace's read to another context.
 *
 * `versions` is the 3-segment root for invalidate; the live infinite query
 * appends nothing (TanStack pages live inside one cache entry) and a
 * single-version read hangs off `version`/`versionNo`.
 *
 * `comments` hangs off the detail key (one thread per document); favorites
 * are org-scoped because the endpoint is (G1-07), so they live under
 * `favoritesRoot` instead of a workspace root.
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
  // G1-05b. Every collection key sits under the workspace root so one
  // `document.*` realtime invalidation still refreshes all of them; the
  // filter is part of the key so two filtered lists never share an entry.
  list: (wsId: string, filterKey: string = "") =>
    [...documentKeys.workspace(wsId), "list", filterKey] as const,
  recent: (wsId: string) => [...documentKeys.workspace(wsId), "recent"] as const,
  sharedWithMe: (wsId: string) => [...documentKeys.workspace(wsId), "shared"] as const,
  tree: (wsId: string, root: string = "") =>
    [...documentKeys.workspace(wsId), "tree", root] as const,
  shares: (wsId: string, documentId: string) =>
    [...documentKeys.detail(wsId, documentId), "shares"] as const,
  accessLogs: (wsId: string, documentId: string, action: string = "") =>
    [...documentKeys.detail(wsId, documentId), "access-logs", action] as const,
  settings: (orgId: string) => [...documentKeys.all, "settings", orgId] as const,
  public: (token: string) => [...documentKeys.all, "public", token] as const,
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
  comments: (wsId: string, documentId: string) =>
    [...documentKeys.detail(wsId, documentId), "comments"] as const,
  /**
   * The favorites prefix: every org-scoped list hangs off it, so one
   * invalidation after a favorite/unfavorite covers the caller's open lists
   * even though the frame cannot name the organization. It sits beside the
   * per-workspace roots rather than under one: a favorite belongs to the
   * person, not the workspace they happen to be looking at.
   */
  favoritesRoot: ["documents", "favorites"] as const,
  favorites: (orgId: string) => [...documentKeys.favoritesRoot, orgId] as const,
};
