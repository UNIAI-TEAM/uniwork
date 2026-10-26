/**
 * Google Drive query-key factory (spec §11, §14, UNI-2186).
 *
 * Every workspace-scoped Drive key sits under `driveKeys.workspace(wsId)`:
 * connections (scoped to the workspace's organization on the server, keyed by
 * `wsId` like `emailHubKeys.accounts`), the 4.1 list, 4.2 detail, and task
 * Drive cards (`driveKeys.task(wsId, taskId)`). Invalidating
 * `driveKeys.workspace(wsId)` refreshes the whole workspace subtree;
 * invalidating `driveKeys.all` refreshes connections and every cached
 * `driveKeys.workspace(*)` across workspaces when `drive_connection.changed`
 * arrives on the user scope.
 */
export const driveKeys = {
  all: ["drive"] as const,
  workspace: (wsId: string) => [...driveKeys.all, wsId] as const,
  connections: (wsId: string) => [...driveKeys.workspace(wsId), "connections"] as const,
};
