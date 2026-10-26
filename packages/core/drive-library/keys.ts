/**
 * Query keys for the Documents › Google Drive library (4.1) and file detail (4.2).
 *
 * Every key MUST sit under the literal prefix `["drive", wsId]` — the same
 * prefix as `driveKeys.workspace(wsId)` in `packages/core/drive/` (UNI-2186 W1)
 * — so realtime invalidation of `drive_file.*`, `drive_task_proposal.converted`
 * and `task.deleted` refreshes these queries automatically. Swap the literal
 * root to `driveKeys.workspace(wsId)` once UNI-2186 W1 lands on the root.
 */
export const driveLibraryKeys = {
  /** Mirrors `driveKeys.workspace(wsId)` from `packages/core/drive/`. */
  workspace: (wsId: string) => ["drive", wsId] as const,
  lists: (wsId: string) => [...driveLibraryKeys.workspace(wsId), "library-files"] as const,
  list: (wsId: string, connectionId?: string | null) =>
    [...driveLibraryKeys.lists(wsId), connectionId || "all"] as const,
  details: (wsId: string) => [...driveLibraryKeys.workspace(wsId), "library-file"] as const,
  detail: (wsId: string, driveFileId: string) =>
    [...driveLibraryKeys.details(wsId), driveFileId] as const,
};
