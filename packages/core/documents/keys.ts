import type { AccessReportFilters } from "../types/document-access-report";

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
    [...documentKeys.listRoot(wsId), filterKey] as const,
  // Prefix of every filtered list entry; `document.lock_changed` invalidates
  // it (rows carry `edit_lock`) without touching detail (UNI-1645).
  listRoot: (wsId: string) => [...documentKeys.workspace(wsId), "list"] as const,
  // Files from chat/task/meeting/email; under the workspace root so a
  // `document.*` invalidation refreshes the section too.
  sources: (wsId: string, filterKey: string = "") =>
    [...documentKeys.sourcesRoot(wsId), filterKey] as const,
  // Prefix of every filtered sources entry (realtime invalidates this one).
  sourcesRoot: (wsId: string) => [...documentKeys.workspace(wsId), "sources"] as const,
  recent: (wsId: string) => [...documentKeys.workspace(wsId), "recent"] as const,
  sharedWithMe: (wsId: string) => [...documentKeys.workspace(wsId), "shared"] as const,
  // The folders-only tree appends a segment, so the full tree's key stays
  // its prefix and one tree invalidation refreshes both.
  tree: (wsId: string, root: string = "", foldersOnly: boolean = false) =>
    foldersOnly
      ? ([...documentKeys.treeRoot(wsId), root, "folders_only"] as const)
      : ([...documentKeys.treeRoot(wsId), root] as const),
  // Prefix of every tree entry (UNI-1645 `document.lock_changed`).
  treeRoot: (wsId: string) => [...documentKeys.workspace(wsId), "tree"] as const,
  /**
   * Who holds the document's edit lock (UNI-1645, R1). Under the workspace
   * root, so a reconnect refreshes it, but outside `detail`: a lock frame
   * must never refetch the document an editor has open.
   */
  editLock: (wsId: string, documentId: string) =>
    [...documentKeys.workspace(wsId), "edit-lock", documentId] as const,
  // What archiving a subtree would move (FD-06). Under the workspace root so
  // a `document.moved`/`archived`/`restored` frame refreshes open counts.
  archiveImpact: (wsId: string, documentId: string) =>
    [...documentKeys.workspace(wsId), "archive-impact", documentId] as const,
  shares: (wsId: string, documentId: string) =>
    [...documentKeys.detail(wsId, documentId), "shares"] as const,
  // Pending access requests (W-DOC07); a child of the detail key like
  // `shares`, so approve/decline invalidate both from one document.
  accessRequests: (wsId: string, documentId: string) =>
    [...documentKeys.detail(wsId, documentId), "access-requests"] as const,
  accessLogs: (wsId: string, documentId: string, action: string = "") =>
    [...documentKeys.detail(wsId, documentId), "access-logs", action] as const,
  // UNI-1643. Under the workspace root so a `document.*` frame refreshes an open
  // report. The filters are normalized (level order, empty values) so one
  // report is one cache entry however the URL spelled it.
  accessReport: (wsId: string, folderId: string | undefined, filters: AccessReportFilters) =>
    [
      ...documentKeys.workspace(wsId),
      "access-report",
      folderId ?? "",
      [filters.personId ?? "", [...(filters.levels ?? [])].sort().join(","), filters.visibility ?? ""].join("|"),
    ] as const,
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
   * The mention picker's people for one document (G8-06). The search term and
   * the page size are part of the key so two pickers asking for different
   * pages never share one entry; the key hangs off the detail root like
   * `comments`, but a comment frame does not touch it - the candidate set
   * changes with access, not with the thread. A nil limit (the server's
   * default page) is a distinct key segment, never confused with a page size.
   */
  mentionCandidates: (wsId: string, documentId: string, query: string = "", limit?: number) =>
    [...documentKeys.detail(wsId, documentId), "mention-candidates", query, limit ?? null] as const,
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
