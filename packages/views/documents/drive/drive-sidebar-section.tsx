"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDriveFiles } from "@uniwork/core/drive-library";
import { cn } from "@uniwork/ui/lib/utils";
import { GoogleDriveMark } from "../../common/provider-icons";
import type { LibraryView } from "../documents-sidebar";
import {
  useDriveLibraryConnections,
  type DriveConnectionSummary,
} from "./use-drive-library-connections";

export interface DriveSidebarSectionProps {
  wsId: string;
  connections?: readonly DriveConnectionSummary[];
  view: LibraryView;
  onSelect: (account: string | null) => void;
}

/**
 * Sidebar section for Documents › Google Drive (spec §7.6, 4.1).
 * Renders "Google Drive" right under "Thư mục của tôi" with the total count,
 * followed by one child row per connected account.
 * Shown when `driveAvailable` and the viewer has at least one connection or at least
 * one linked Drive file (so disconnected users can still reach their `bound_connection_lost`
 * files and reconnect). Hidden when both are empty or while the fallback files check is loading.
 * Never renders "Người khác liên kết" (Q6).
 */
export function DriveSidebarSection({
  wsId,
  connections: connectionsProp,
  view,
  onSelect,
}: DriveSidebarSectionProps) {
  const { t } = useTranslation();
  const {
    connections: defaultConnections,
    isLoading: defaultConnectionsLoading,
    driveAvailable,
  } = useDriveLibraryConnections(wsId, {
    enabled: connectionsProp === undefined,
  });
  const connectionsLoading = connectionsProp === undefined && defaultConnectionsLoading;
  const connections = driveAvailable ? (connectionsProp ?? defaultConnections) : [];
  const needFilesCheck = driveAvailable && !connectionsLoading && connections.length === 0;
  const filesQuery = useDriveFiles(wsId, {
    connectionId: null,
    enabled: needFilesCheck,
  });
  const firstPage = filesQuery.data?.pages[0];
  const fallbackFileCount = Math.max(firstPage?.total_count ?? 0, firstPage?.files.length ?? 0);
  const hasLinkedFiles = fallbackFileCount > 0;

  if (
    !driveAvailable ||
    (connections.length === 0 && (connectionsLoading || filesQuery.isLoading || !hasLinkedFiles))
  ) {
    return null;
  }

  const resolvedTotal =
    connections.length > 0
      ? connections.reduce((sum, conn) => sum + Math.max(0, conn.linked_file_count), 0)
      : fallbackFileCount;
  const isAllCurrent = view.kind === "drive" && !view.account;

  return (
    <div className="mb-1.5 flex flex-col gap-0.5">
      <button
        type="button"
        aria-current={isAllCurrent ? "page" : undefined}
        onClick={() => onSelect(null)}
        className={cn(
          "flex min-h-9 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-body text-foreground transition-colors hover:bg-accent/60 pointer-coarse:min-h-11",
          isAllCurrent && "bg-brand-subtle font-medium text-brand-subtle-foreground hover:bg-brand-subtle",
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          <GoogleDriveMark className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{t("driveLibrary.sidebar.google_drive")}</span>
        <span className="font-mono text-caption tabular-nums text-muted-foreground">{resolvedTotal}</span>
      </button>

      {connections.map((conn) => {
        const isCurrent = view.kind === "drive" && view.account === conn.id;
        const accountLabel = t("driveLibrary.sidebar.account_row", { email: conn.google_email });
        const disconnectedLabel = t("driveLibrary.sidebar.disconnected");
        const rowTitle = conn.needs_reconnect
          ? `${accountLabel} · ${disconnectedLabel}`
          : accountLabel;
        return (
          <button
            key={conn.id}
            type="button"
            title={rowTitle}
            aria-current={isCurrent ? "page" : undefined}
            onClick={() => onSelect(conn.id)}
            className={cn(
              "flex min-h-9 w-full shrink-0 items-center gap-2 rounded-md pl-9 pr-2 text-left text-body text-foreground transition-colors hover:bg-accent/60 pointer-coarse:min-h-11",
              isCurrent && "bg-brand-subtle font-medium text-brand-subtle-foreground hover:bg-brand-subtle",
            )}
          >
            <span className="sr-only">{accountLabel}</span>
            <span aria-hidden className="min-w-0 flex-1 truncate">
              {conn.google_email}
            </span>
            {conn.needs_reconnect ? (
              <span className="inline-flex shrink-0 items-center text-warning">
                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                <span className="sr-only">{disconnectedLabel}</span>
              </span>
            ) : null}
            <span className="font-mono text-caption tabular-nums text-muted-foreground">
              {conn.linked_file_count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
