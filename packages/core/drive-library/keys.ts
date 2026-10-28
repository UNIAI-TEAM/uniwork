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
  /** `driveFolderId` is a Drive folder id or `none`; omitted = the whole list (no folder filter). */
  list: (wsId: string, connectionId?: string | null, driveFolderId?: string | null) =>
    driveFolderId
      ? ([...driveLibraryKeys.lists(wsId), connectionId || "all", driveFolderId] as const)
      : ([...driveLibraryKeys.lists(wsId), connectionId || "all"] as const),
  folderLists: (wsId: string) => [...driveLibraryKeys.workspace(wsId), "library-folders"] as const,
  folders: (wsId: string, connectionId?: string | null) =>
    [...driveLibraryKeys.folderLists(wsId), connectionId || "all"] as const,
  details: (wsId: string) => [...driveLibraryKeys.workspace(wsId), "library-file"] as const,
  detail: (wsId: string, driveFileId: string) =>
    [...driveLibraryKeys.details(wsId), driveFileId] as const,
  task: (wsId: string, taskId: string) => driveKeys.task(wsId, taskId),
};
