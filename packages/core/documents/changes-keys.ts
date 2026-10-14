/**
 * Query-key factory for the Office change feed (G5-02). Every key carries
 * `wsId`. The root is deliberately NOT under `documentKeys.workspace`: a
 * `document.*` realtime frame invalidates that prefix, and a cursor page is a
 * point-in-time read (a snapshot page, or the feed past a cursor) that must
 * not refetch because some document changed. The feed is the catch-up path
 * for the frames a client missed, so its pages are fetched on purpose.
 *
 * The cursor and the limit are part of the key, so two pages never share an
 * entry; an empty cursor (and 0 limit) is the cold start with server defaults.
 */
export const documentChangesKeys = {
  all: ["document-changes"] as const,
  workspace: (wsId: string) => [...documentChangesKeys.all, wsId] as const,
  page: (wsId: string, cursor: string = "", limit: number = 0) =>
    [...documentChangesKeys.workspace(wsId), "page", cursor, limit] as const,
};
