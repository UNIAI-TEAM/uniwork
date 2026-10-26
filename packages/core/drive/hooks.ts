"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  disconnectDriveConnection,
  isDriveConnectionLost,
  listDriveConnections,
  startDriveConnect,
  type DriveConnection,
  type DriveConnectionList,
} from "../api/endpoints/drive";
import { driveKeys } from "./keys";

export {
  driveKeys,
  isDriveConnectionLost,
  type DriveConnection,
  type DriveConnectionList,
};

/**
 * Lists the caller's Google Drive connections in the workspace's organization.
 * Drive queries enable `refetchOnWindowFocus` (spec §11) so returning from a
 * browser tab or popup refreshes connection state.
 */
export function useDriveConnections(wsId: string, options?: { enabled?: boolean }) {
  return useQuery<DriveConnectionList>({
    queryKey: driveKeys.connections(wsId),
    queryFn: () => listDriveConnections(wsId),
    enabled: (options?.enabled ?? true) && Boolean(wsId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Resolves the Google OAuth consent URL for a popup sign-in or reconnect.
 * The connection row updates after the callback (via popup outcome or
 * `drive_connection.changed`), so the cache is left untouched here.
 */
export function useStartDriveConnect(wsId: string) {
  return useMutation({
    mutationFn: (options?: { reconnect_connection_id?: string }) =>
      startDriveConnect(wsId, options),
  });
}

/**
 * Disconnects a Google Drive connection. Awaits the server response (no
 * optimistic removal) and invalidates all workspace Drive queries on success.
 */
export function useDisconnectDriveConnection(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => disconnectDriveConnection(wsId, connectionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: driveKeys.workspace(wsId) });
    },
  });
}
