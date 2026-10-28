import { driveKeys } from "../drive/keys";

/**
 * The query keys a Google Drive realtime frame (or `task.deleted`) invalidates,
 * or null when the frame does not affect Drive (spec §11, UNI-2186).
 *
 * `type` is a plain string so the client invalidates even before `drive_*`
 * catalogue rows land in `packages/core/types/events.ts` (owned by drive-be).
 * Every Drive frame is ids-only (ADR 0015): it marks queries stale and never
 * writes frame payloads into the cache.
 *
 * Rules (spec §11):
 * - `drive_file.*` -> `driveKeys.workspace(wsId)` when the frame belongs to
 *   this workspace.
 * - `drive_connection.changed` -> `driveKeys.connections(wsId)` and every
 *   cached `driveKeys.workspace(*)` (`driveKeys.all` is the prefix of all of
 *   them).
 * - `drive_task_proposal.converted` and `task.deleted` ->
 *   `driveKeys.workspace(wsId)` so "tasks created from this document" (§8.8)
 *   refreshes when tasks are converted or deleted.
 */
export function driveFrameKeys(
  wsId: string,
  type: string,
  payload: Record<string, string>,
): (readonly unknown[])[] | null {
  const ownWorkspace = !payload.workspace_id || payload.workspace_id === wsId;

  if (type === "drive_connection.changed") {
    return [driveKeys.connections(wsId), driveKeys.all];
  }

  if (type.startsWith("drive_file.")) {
    if (!ownWorkspace) return [];
    const keys: (readonly unknown[])[] = [driveKeys.workspace(wsId)];
    // Include the explicit task key alongside the workspace prefix so callers
    // inspecting exact task-scoped invalidations see both immediately.
    if (payload.task_id) {
      keys.push(driveKeys.task(wsId, payload.task_id));
    }
    return keys;
  }

  if (type === "drive_task_proposal.converted" || type === "task.deleted") {
    return ownWorkspace ? [driveKeys.workspace(wsId)] : [];
  }
  return null;
}
