"use client";

import { ChevronRight, Ellipsis, Pencil, TriangleAlert } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DriveFolderEntry } from "@uniwork/core/drive-library/folders";
import { useDriveAccountFolders } from "@uniwork/core/drive-library/use-account-folders";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { DOCUMENTS_NAV_ICONS } from "../documents-nav-icons";
import { driveFolderLabel } from "./drive-folder-label";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

const COUNT_CLASS = "ml-auto shrink-0 font-mono text-caption tabular-nums text-muted-foreground";
const ROW_CLASS =
  "flex min-h-9 w-full shrink-0 items-center gap-2 rounded-md text-left text-body text-foreground transition-colors hover:bg-accent/60 pointer-coarse:min-h-11";
const CURRENT_CLASS = "bg-brand-subtle font-medium text-brand-subtle-foreground hover:bg-brand-subtle";

interface DriveSidebarAccountProps {
  wsId: string;
  connection: DriveConnectionSummary;
  /** The account row is the selected node (no folder under it is). */
  accountCurrent: boolean;
  /** The selected folder of this account, when one is. */
  currentFolderId: string | null;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (account: string, folder: string | null) => void;
  /**
   * "Name this folder" on an unnamed node. A host passes it when it can open the Google Picker;
   * without it the row menu is not drawn. It is drawn only for a folder list that came from the server:
   * the route that names a folder is as new as that list.
   */
  onNameFolder?: (folder: DriveFolderEntry, connectionId: string) => void;
}

function FolderRow({
  folder,
  current,
  menu,
  onSelect,
}: {
  folder: DriveFolderEntry;
  current: boolean;
  menu: ReactNode;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const label = driveFolderLabel(folder, t);
  return (
    <div className="group/row relative flex items-center rounded-md">
      <button
        type="button"
        title={label}
        aria-current={current ? "page" : undefined}
        onClick={onSelect}
        // Icon starts at x=56px, exactly under the account email: 28 (account chevron) + 16 chevron slot + 12 gap.
        style={{ paddingLeft: "56px" }}
        className={cn(ROW_CLASS, "min-w-0 flex-1 pr-2", current && CURRENT_CLASS)}
      >
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          <DOCUMENTS_NAV_ICONS.folder className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {/* The action sits over the count, so the label keeps its full width; the count steps aside while it shows. */}
        <span
          className={cn(
            COUNT_CLASS,
            menu && "group-hover/row:invisible group-focus-within/row:invisible",
          )}
        >
          <span aria-hidden>{folder.fileCount}</span>
          <span className="sr-only">{t("driveLibrary.folder.count", { count: folder.fileCount })}</span>
        </span>
      </button>
      {menu}
    </div>
  );
}

/** One connected account of the Drive tree: expandable, with the account's folders beneath it. */
export function DriveSidebarAccount({
  wsId,
  connection,
  accountCurrent,
  currentFolderId,
  expanded,
  onToggle,
  onSelect,
  onNameFolder,
}: DriveSidebarAccountProps) {
  const { t, i18n } = useTranslation();
  const groupId = useId();
  const folders = useDriveAccountFolders(wsId, connection.id, {
    enabled: expanded,
    locale: i18n.language,
    withFiles: false,
  });
  const accountLabel = t("driveLibrary.sidebar.account_row", { email: connection.google_email });
  const disconnectedLabel = t("driveLibrary.sidebar.disconnected");
  // An unknown folder id shows the account view, so the account row is the current node then.
  const accountIsCurrent = accountCurrent && !folders.folders.some((f) => f.id === currentFolderId);
  // Known to have no folders: not loading, not failed, nothing derived.
  const noFolders = expanded && !folders.isPending && !folders.isError && folders.folders.length === 0;
  const rowTitle = connection.needs_reconnect ? `${accountLabel} · ${disconnectedLabel}` : accountLabel;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center" style={{ paddingLeft: "28px" }}>
        <button
          type="button"
          data-chevron
          hidden={noFolders}
          aria-expanded={expanded}
          aria-controls={groupId}
          aria-label={
            expanded
              ? t("documents.tree.collapse", { title: connection.google_email })
              : t("documents.tree.expand", { title: connection.google_email })
          }
          onClick={onToggle}
          className="relative z-10 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground before:absolute before:content-[''] before:-inset-1 pointer-coarse:before:-left-2 pointer-coarse:before:-right-5 pointer-coarse:before:-top-3.5 pointer-coarse:before:-bottom-3.5"
        >
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
        <button
          type="button"
          title={rowTitle}
          aria-current={accountIsCurrent ? "page" : undefined}
          onClick={() => onSelect(connection.id, null)}
          // Email starts at x=56px, exactly under the "Google Drive" label: 28 + 16 chevron + 12 (pl-3). No icon on account rows.
          className={cn(ROW_CLASS, "min-w-0 flex-1 pl-3 pr-2", accountIsCurrent && CURRENT_CLASS)}
        >
          <span className="sr-only">{accountLabel}</span>
          <span aria-hidden className="min-w-0 flex-1 truncate">
            {connection.google_email}
          </span>
          {connection.needs_reconnect ? (
            <span className="inline-flex shrink-0 items-center text-warning">
              <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
              <span className="sr-only">{disconnectedLabel}</span>
            </span>
          ) : null}
          <span className={COUNT_CLASS}>{connection.linked_file_count}</span>
        </button>
      </div>

      <div id={groupId} hidden={!expanded} className="flex flex-col gap-0.5">
        {expanded && folders.isPending ? (
          <div
            role="status"
            style={{ paddingLeft: "56px" }}
            className="flex min-h-9 items-center gap-2 pr-2 text-caption text-muted-foreground"
          >
            <Spinner aria-hidden role="presentation" />
            {t("driveLibrary.sidebar.folders_loading")}
          </div>
        ) : null}
        {expanded && folders.isError && folders.files.length === 0 ? (
          <p role="alert" style={{ paddingLeft: "56px" }} className="pr-2 py-1.5 text-caption text-destructive">
            {t("driveLibrary.sidebar.folders_error")}
          </p>
        ) : null}
        {expanded && folders.isLoadMoreError ? (
          <div
            role="alert"
            style={{ paddingLeft: "56px" }}
            className="flex flex-wrap items-center gap-2 py-1.5 pr-2 text-caption text-destructive"
          >
            <span>{t("driveLibrary.sidebar.folders_error")}</span>
            <Button type="button" variant="outline" size="sm" onClick={folders.retryLoadMore}>
              {t("driveLibrary.list.retry")}
            </Button>
          </div>
        ) : null}
        {folders.folders.map((folder) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            current={currentFolderId === folder.id}
            onSelect={() => onSelect(connection.id, folder.id)}
            menu={
              onNameFolder && folders.serverList && folder.name === null ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("driveLibrary.folder.menu_aria", { name: driveFolderLabel(folder, t) })}
                        className="absolute end-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100"
                      />
                    }
                  >
                    <Ellipsis aria-hidden className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuItem
                      className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
                      onClick={() => onNameFolder(folder, connection.id)}
                    >
                      <Pencil aria-hidden className="size-3.5" />
                      {t("driveLibrary.folder.name_action")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null
            }
          />
        ))}
      </div>
    </div>
  );
}
