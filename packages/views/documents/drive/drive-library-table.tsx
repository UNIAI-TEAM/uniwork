"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DriveFile } from "@uniwork/core/drive-library";
import type { DriveFolderEntry } from "@uniwork/core/drive-library/folders";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { DocumentTypeIcon } from "../document-type-icon";
import { DOCUMENTS_NAV_ICONS } from "../documents-nav-icons";
import { driveFolderLabel } from "./drive-folder-label";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

type Translate = (key: string, opts?: Record<string, unknown>) => string;

function formatSharingBadge(
  file: DriveFile,
  t: Translate,
): { label: string; className: string } {
  if (file.drive_id) {
    return {
      label: t("driveLibrary.list.access.shared_drive"),
      className: "bg-muted text-foreground",
    };
  }
  switch (file.sharing_state) {
    case "private":
      return {
        label: t("driveLibrary.list.access.private"),
        className: "bg-warning/15 text-warning",
      };
    case "shared":
      return {
        label:
          typeof file.shared_user_count === "number"
            ? t("driveLibrary.list.access.shared_count", { count: file.shared_user_count })
            : t("driveLibrary.list.access.shared"),
        className: "bg-success/15 text-success",
      };
    default:
      return {
        label: t("driveLibrary.list.access.unknown"),
        className: "bg-muted text-muted-foreground",
      };
  }
}

function formatUsedIn(
  file: DriveFile,
  t: Translate,
): string {
  const first = file.used_in_tasks[0];
  const total = Math.max(file.used_in_count, file.used_in_tasks.length);
  if (!first || total === 0) {
    return t("driveLibrary.list.used_in.none");
  }
  const remaining = total - 1;
  if (remaining <= 0) {
    return t("driveLibrary.list.used_in.single", { identifier: first.identifier });
  }
  return t("driveLibrary.list.used_in.more", { identifier: first.identifier, count: remaining });
}

interface DriveLibraryTableProps {
  /** Folder rows drawn before the files (account view); empty elsewhere. */
  folders: readonly DriveFolderEntry[];
  files: readonly DriveFile[];
  connectionById: ReadonlyMap<string, DriveConnectionSummary>;
  reconnectHref: string;
  fileHref: (fileId: string) => string;
  folderHref: (folderId: string) => string;
}

function DriveFolderRow({ folder, href }: { folder: DriveFolderEntry; href: string }) {
  const { t } = useTranslation();
  const label = driveFolderLabel(folder, t);
  const count = t("driveLibrary.folder.count", { count: folder.fileCount });
  return (
    <tr className="hover:bg-accent/40">
      <td className="w-full max-w-0 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3 md:items-center">
          <DOCUMENTS_NAV_ICONS.folder aria-hidden className="mt-0.5 size-6 shrink-0 text-muted-foreground md:mt-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1 md:gap-0">
            <AppLink
              href={href}
              title={label}
              className="inline-flex min-h-6 min-w-0 max-w-full items-center font-medium text-foreground hover:underline pointer-coarse:min-h-11"
            >
              <span className="min-w-0 truncate">{label}</span>
            </AppLink>
            <span className="text-caption text-muted-foreground md:hidden">{count}</span>
          </div>
        </div>
      </td>
      <td colSpan={COLUMN_COUNT - 1} className="hidden whitespace-nowrap px-3 py-3 text-caption text-muted-foreground md:table-cell">
        {count}
      </td>
    </tr>
  );
}

const COLUMN_COUNT = 5;

function DriveFileRow({
  file,
  connectionById,
  reconnectHref,
  fileHref,
}: {
  file: DriveFile;
  connectionById: ReadonlyMap<string, DriveConnectionSummary>;
  reconnectHref: string;
  fileHref: (fileId: string) => string;
}) {
  const { t } = useTranslation();
  const badge = formatSharingBadge(file, t);
  const viewerConn = file.viewer_connection_id
    ? connectionById.get(file.viewer_connection_id)
    : undefined;
  const rowNeedsReconnect =
    file.viewer_access === "connection_lost" || Boolean(viewerConn?.needs_reconnect);
  const accountEmail =
    file.viewer_account_email || t("driveLibrary.list.no_account_value");
  const createdCount = file.tasks_created?.count ?? 0;

  return (
    <tr className="hover:bg-accent/40">
      <td className="w-full max-w-0 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3 md:items-center">
          <DocumentTypeIcon format={file.icon_kind} className="mt-0.5 size-6 shrink-0 md:mt-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1 md:gap-0">
            <AppLink
              href={fileHref(file.id)}
              title={file.name}
              className="inline-flex min-h-6 min-w-0 max-w-full items-center font-medium text-foreground hover:underline pointer-coarse:min-h-11"
            >
              <span className="min-w-0 truncate">{file.name}</span>
            </AppLink>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground md:hidden">
              <span className="truncate text-foreground">{accountEmail}</span>
              <span aria-hidden>·</span>
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium",
                  badge.className,
                )}
              >
                {badge.label}
              </span>
              {rowNeedsReconnect ? (
                <AppLink
                  href={reconnectHref}
                  className="inline-flex min-h-6 basis-full items-center gap-1 text-caption text-warning hover:underline pointer-coarse:min-h-11"
                >
                  <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                  <span>{t("driveLibrary.list.reconnect_inline")}</span>
                </AppLink>
              ) : null}
            </div>
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-3 md:table-cell">
        <div className="flex flex-col gap-0.5">
          <span title={accountEmail} className="block truncate text-caption text-foreground">{accountEmail}</span>
          {rowNeedsReconnect ? (
            <AppLink
              href={reconnectHref}
              className="inline-flex min-h-6 items-center gap-1 text-caption text-warning hover:underline pointer-coarse:min-h-11"
            >
              <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0">{t("driveLibrary.list.reconnect_inline")}</span>
            </AppLink>
          ) : null}
        </div>
      </td>
      <td className="hidden px-3 py-3 md:table-cell">
        <span
          title={badge.label}
          className={cn(
            "inline-block max-w-full truncate rounded-md px-2 py-0.5 align-middle text-caption font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </td>
      <td className="hidden px-3 py-3 text-caption text-muted-foreground md:table-cell">
        {formatUsedIn(file, t)}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-3 text-caption text-muted-foreground md:table-cell">
        {createdCount > 0
          ? t("driveLibrary.list.tasks_created", { count: createdCount })
          : null}
      </td>
    </tr>
  );
}

export function DriveLibraryTable({
  folders,
  files,
  connectionById,
  reconnectHref,
  fileHref,
  folderHref,
}: DriveLibraryTableProps) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full table-fixed border-collapse text-body md:min-w-[41rem]">
        <thead>
          <tr className="border-b border-border text-left text-caption text-muted-foreground">
            <th scope="col" className="w-full px-4 py-3 font-medium md:w-auto">
              {t("driveLibrary.list.columns.name")}
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell md:w-32">
              {t("driveLibrary.list.columns.account")}
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell md:w-40">
              {t("driveLibrary.list.columns.access")}
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell md:w-32">
              {t("driveLibrary.list.columns.used_in")}
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell md:w-20">
              {t("driveLibrary.list.columns.tasks_created")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {folders.map((folder) => (
            <DriveFolderRow key={`folder:${folder.id}`} folder={folder} href={folderHref(folder.id)} />
          ))}
          {files.map((file) => (
            <DriveFileRow
              key={file.id}
              file={file}
              connectionById={connectionById}
              reconnectHref={reconnectHref}
              fileHref={fileHref}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
