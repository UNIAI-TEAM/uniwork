"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDriveFiles } from "@uniwork/core/drive-library";
import type { DriveFolderEntry } from "@uniwork/core/drive-library/folders";
import { cn } from "@uniwork/ui/lib/utils";
import { GoogleDriveMark } from "../../common/provider-icons";
import type { LibraryView } from "../documents-sidebar";
import { DriveSidebarAccount } from "./drive-sidebar-account";
import {
  useDriveLibraryConnections,
  type DriveConnectionSummary,
} from "./use-drive-library-connections";

export interface DriveSidebarSectionProps {
  wsId: string;
  connections?: readonly DriveConnectionSummary[];
  view: LibraryView;
  onSelect: (account: string | null, folder: string | null) => void;
  /** "Name this folder" on an unnamed folder node; omit while the server route does not exist. */
  onNameFolder?: (folder: DriveFolderEntry, connectionId: string) => void;
}

/**
 * Sidebar section for Documents › Google Drive (spec §7.6, 4.1).
 * Renders "Google Drive" right under "Thư mục của tôi" with the total count,
 * followed by one expandable row per connected account whose children are that account's Drive
 * folders (drive-folder contract v2).
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
  onNameFolder,
}: DriveSidebarSectionProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const selectedAccount = view.kind === "drive" ? view.account : null;
  const selectedFolder = view.kind === "drive" ? view.folder : null;
  // Accounts open for this session; the selected account is always among them so a reload or
  // Back/Forward onto a folder shows where it sits.
  const [openAccounts, setOpenAccounts] = useState<ReadonlySet<string>>(
    () => new Set(selectedAccount ? [selectedAccount] : []),
  );
  useEffect(() => {
    if (!selectedAccount) return;
    setOpenAccounts((prev) => (prev.has(selectedAccount) ? prev : new Set(prev).add(selectedAccount)));
  }, [selectedAccount]);
  const toggleAccount = (id: string) =>
    setOpenAccounts((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const accountsGroupId = useId();
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
  const hasChildren = connections.length > 0;
  const driveTitle = t("driveLibrary.sidebar.google_drive");

  return (
    <div className="mb-1.5 flex flex-col gap-0.5">
      <div
        className={cn(
          "flex min-h-9 w-full shrink-0 items-center gap-1 rounded-md px-2 text-body text-foreground transition-colors hover:bg-accent/60 pointer-coarse:min-h-11",
          isAllCurrent && "bg-brand-subtle font-medium text-brand-subtle-foreground hover:bg-brand-subtle",
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            data-chevron
            aria-expanded={expanded}
            aria-controls={accountsGroupId}
            aria-label={
              expanded
                ? t("documents.tree.collapse", { title: driveTitle })
                : t("documents.tree.expand", { title: driveTitle })
            }
            onClick={() => setExpanded((prev) => !prev)}
            className="relative z-10 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground before:absolute before:content-[''] before:-inset-1 pointer-coarse:before:-left-2 pointer-coarse:before:-right-5 pointer-coarse:before:-top-3.5 pointer-coarse:before:-bottom-3.5"
          >
            <ChevronRight
              aria-hidden
              className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
            />
          </button>
        ) : (
          <span aria-hidden data-chevron-placeholder className="size-4 shrink-0" />
        )}
        <button
          type="button"
          aria-current={isAllCurrent ? "page" : undefined}
          onClick={() => onSelect(null, null)}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md text-left pointer-coarse:min-h-11"
        >
          <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
            <GoogleDriveMark className="size-4" />
          </span>
          <span title={driveTitle} className="min-w-0 flex-1 truncate">{driveTitle}</span>
          <span className="ml-auto shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
            {resolvedTotal}
          </span>
        </button>
      </div>

      {hasChildren ? (
        <div id={accountsGroupId} hidden={!expanded} className="flex flex-col gap-0.5">
          {connections.map((conn) => (
            <DriveSidebarAccount
              key={conn.id}
              wsId={wsId}
              connection={conn}
              accountCurrent={view.kind === "drive" && selectedAccount === conn.id && !selectedFolder}
              currentFolderId={selectedAccount === conn.id ? selectedFolder : null}
              expanded={openAccounts.has(conn.id)}
              onToggle={() => toggleAccount(conn.id)}
              onSelect={onSelect}
              onNameFolder={onNameFolder}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
