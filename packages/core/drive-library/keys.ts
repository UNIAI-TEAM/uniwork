import { driveKeys } from "../drive/keys";

/**
 * Query keys for the Documents › Google Drive library (4.1) and file detail (4.2).
 *
 * Every key sits under `driveKeys.workspace(wsId)` (`["drive", wsId]`) from
 * `packages/core/drive/` (UNI-2186 W1) so realtime invalidation of `drive_file.*`,
 * `drive_task_proposal.converted` and `task.deleted` refreshes these queries automatically.
 */
export const driveLibraryKeys = {
  workspace: (wsId: string) => driveKeys.workspace(wsId),
  lists: (wsId: string) => [...driveLibraryKeys.workspace(wsId), "library-files"] as const,
  list: (wsId: string, connectionId?: string | null) =>
    [...driveLibraryKeys.lists(wsId), connectionId || "all"] as const,
  details: (wsId: string) => [...driveLibraryKeys.workspace(wsId), "library-file"] as const,
  detail: (wsId: string, driveFileId: string) =>
    [...driveLibraryKeys.details(wsId), driveFileId] as const,
};
