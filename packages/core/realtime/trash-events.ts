import { trashKeys } from "../trash/keys";

// Frames that move an item into the trash, out of it, or purge it.
const TRASH_EVENTS: ReadonlySet<string> = new Set([
  "task.trashed",
  "task.restored",
  "task.deleted",
  "project.trashed",
  "project.restored",
  "project.deleted",
  "document.archived",
  "document.restored",
  "document.deleted",
]);

/** The shared trash refreshes on a trash frame of this workspace; a frame without a workspace id counts as ours. */
export function trashFrameKeys(
  wsId: string,
  type: string,
  payload: Record<string, string>,
): (readonly unknown[])[] {
  const ownWorkspace = !payload.workspace_id || payload.workspace_id === wsId;
  return TRASH_EVENTS.has(type) && ownWorkspace ? [trashKeys.workspace(wsId)] : [];
}
