"use client";

import { useMemo } from "react";
import {
  isDriveConnectionLost,
  useDriveConnections,
  type DriveConnection,
} from "@uniwork/core/drive";
import { EMPTY_CONFIG, useFlag, usePublicConfig } from "@uniwork/core/feature-flags";
import { DRIVE_CONNECTOR_FLAG } from "../../settings/components/drive-integration-row";

export interface DriveConnectionSummary {
  id: string;
  google_email: string;
  needs_reconnect: boolean;
  linked_file_count: number;
}

function toDriveConnectionSummary(conn: DriveConnection): DriveConnectionSummary {
  return {
    id: conn.id,
    google_email: conn.google_email,
    needs_reconnect: isDriveConnectionLost(conn),
    linked_file_count: Math.max(0, conn.linked_file_count ?? 0),
  };
}

export interface UseDriveLibraryConnectionsResult {
  connections: DriveConnectionSummary[];
  isLoading: boolean;
  driveAvailable: boolean;
  configWaitForDrive: boolean;
}

/**
 * Adapter for the caller's connected Google Drive accounts in the workspace,
 * backed by `useDriveConnections(wsId, { enabled })` from `@uniwork/core/drive` (UNI-2186 W1).
 * Returns `[]` unless the Drive connector gate (`DRIVE_CONNECTOR_FLAG` && `drive.available`) is active,
 * and tolerates `connections: null` from server responses (W8-R2 note).
 */
export function useDriveLibraryConnections(
  wsId: string,
  options?: { enabled?: boolean },
): UseDriveLibraryConnectionsResult {
  const flagEnabled = useFlag(DRIVE_CONNECTOR_FLAG, false);
  const publicConfigQuery = usePublicConfig();
  const config = publicConfigQuery.data ?? EMPTY_CONFIG;
  const driveAvailable = flagEnabled && Boolean(config.drive?.available);
  const configWaitForDrive =
    publicConfigQuery.isLoading && publicConfigQuery.errorUpdateCount === 0;
  const queryEnabled = (options?.enabled ?? true) && driveAvailable;
  const query = useDriveConnections(wsId, { enabled: queryEnabled });

  const connections = useMemo(() => {
    if (!driveAvailable) return [];
    const raw: readonly DriveConnection[] | null | undefined = query.data?.connections;
    if (!Array.isArray(raw)) return [];
    return raw.map(toDriveConnectionSummary);
  }, [driveAvailable, query.data?.connections]);

  return {
    connections,
    isLoading: configWaitForDrive || (queryEnabled && query.isLoading),
    driveAvailable,
    configWaitForDrive,
  };
}
