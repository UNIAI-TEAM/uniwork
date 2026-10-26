"use client";

import type { ReactNode } from "react";
import type { LibraryView } from "../documents-sidebar";
import { DriveLibraryListView } from "./drive-library-list-view";
import type { DriveConnectionSummary } from "./use-drive-library-connections";
export type { DriveConnectionSummary };

export interface DocumentsDrivePageOptions {
  wsId: string;
  view: LibraryView;
  driveConnections?: readonly DriveConnectionSummary[];
  onAddFromDrive?: (connectionId: string | null) => void;
  zoneProps: Record<string, unknown>;
}

export interface DocumentsDrivePageBranch {
  renderDriveView: (navButton: ReactNode) => ReactNode;
  sectionZoneProps: Record<string, unknown>;
  sidebarDriveProps: { driveConnections?: readonly DriveConnectionSummary[] };
}

/**
 * Wiring for the Documents › Google Drive (`?view=drive`) branch inside `DocumentsPageView`.
 * Returns the rendered Drive list view when `view.kind === "drive"`, disables the native
 * upload drop zone on the Drive screen, and forwards optional Drive connection overrides
 * to the sidebar.
 */
export function buildDocumentsDriveBranch({
  wsId,
  view,
  driveConnections,
  onAddFromDrive,
  zoneProps,
}: DocumentsDrivePageOptions): DocumentsDrivePageBranch {
  if (view.kind === "drive") {
    return {
      renderDriveView: (navButton) => (
        <DriveLibraryListView
          wsId={wsId}
          accountId={view.account}
          connections={driveConnections}
          navButton={navButton}
          onAddFromDrive={onAddFromDrive}
        />
      ),
      sectionZoneProps: {},
      sidebarDriveProps: { driveConnections },
    };
  }
  return {
    renderDriveView: () => null,
    sectionZoneProps: zoneProps,
    sidebarDriveProps: { driveConnections },
  };
}
