"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  disconnectDriveConnection,
  getDrivePickerToken,
  isDriveConnectionLost,
  linkDriveFiles,
  listDriveConnections,
  startDriveConnect,
  type DriveConnection,
  type DriveConnectionList,
  type DriveFileLinkItem,
  type DriveFileLinkReceipt,
  type DriveFileLinkResults,
  type DrivePickerToken,
  type LinkDriveFilesBody,
} from "../api/endpoints/drive";
import { driveKeys } from "./keys";

export {
  driveKeys,
  isDriveConnectionLost,
  type DriveConnection,
  type DriveConnectionList,
  type DriveFileLinkItem,
  type DriveFileLinkReceipt,
  type DriveFileLinkResults,
  type DrivePickerToken,
  type LinkDriveFilesBody,
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

/**
 * Fetches a short-lived `drive.file` access token + developer key + app ID for
 * Google Picker (`POST .../drive-connections/{id}/picker-token`). Never cached
 * in QueryCache (spec §7.1, §12.4).
 */
export function useDrivePickerToken(wsId: string) {
  return useMutation({
    gcTime: 0,
    mutationFn: (connectionId: string) => getDrivePickerToken(wsId, connectionId),
  });
}

/**
 * Links 1..20 Google Drive files to the workspace (and optionally a task) in
 * one server call (`POST /workspaces/{ws}/drive-files`). Awaits the server
 * response (no optimistic update) and invalidates `driveKeys.workspace(wsId)`.
 */
export function useLinkDriveFiles(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkDriveFilesBody) => linkDriveFiles(wsId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: driveKeys.workspace(wsId) });
    },
  });
}
