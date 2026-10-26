"use client";

export interface DriveConnectionSummary {
  id: string;
  google_email: string;
  needs_reconnect: boolean;
  linked_file_count: number;
}

export interface UseDriveLibraryConnectionsResult {
  connections: DriveConnectionSummary[];
  isLoading: boolean;
}

/**
 * Adapter seam for the caller's connected Google Drive accounts in the workspace.
 * TODO(UNI-2186 W1): swap to `useDriveConnections(wsId)` from `@uniwork/core/drive` once W1 lands on the root.
 */
export function useDriveLibraryConnections(_wsId: string): UseDriveLibraryConnectionsResult {
  // TODO(UNI-2186 W1): replace with useDriveConnections(_wsId)
  return {
    connections: [],
    isLoading: false,
  };
}
