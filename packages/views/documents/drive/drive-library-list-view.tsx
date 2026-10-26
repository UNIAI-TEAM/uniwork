"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CircleAlert, FolderOpen, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDriveFiles, type DriveFile } from "@uniwork/core/drive-library";
import { paths } from "@uniwork/core/paths";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../../layout/collection-page";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { AppLink, useNavigation } from "../../navigation";
import { DocumentTypeIcon } from "../document-type-icon";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

export interface DriveLibraryListViewProps {
  wsId: string;
  accountId: string | null;
  connections: readonly DriveConnectionSummary[];
  /** Optional mobile sidebar opener button rendered in the header. */
  navButton?: ReactNode;
  /** Seam for W3 Picker: opens Picker for all connections (`null`) or the selected account. */
  onAddFromDrive?: (connectionId: string | null) => void;
  /** Optional reconnect callback for a broken account row; defaults to Settings › Integrations link. */
  onReconnect?: (connectionId: string) => void;
}

function formatSharingBadge(
  file: DriveFile,
  t: (key: string, opts?: Record<string, unknown>) => string,
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
  t: (key: string, opts?: Record<string, unknown>) => string,
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

/**
 * 4.1 Documents › Google Drive list screen (`?view=drive[&account=<id>]`, spec §7.6, §7.10, §7.11).
 * Shows only the caller's own linked Google Drive files.
 */
export function DriveLibraryListView({
  wsId,
  accountId,
  connections,
  navButton,
  onAddFromDrive,
  onReconnect,
}: DriveLibraryListViewProps) {
  const { t } = useTranslation();
  const context = useOptionalWorkspace();
  const { searchParams, replace } = useNavigation();
  const addBtnRef = useRef<HTMLButtonElement | null>(null);

  const wsPaths = paths.workspace(
    context?.workspace.organization_slug || "org",
    context?.workspace.slug || wsId,
  );
  const settingsIntegrationsHref = `${wsPaths.settings()}?tab=integrations`;

  const selectedConnection = accountId
    ? connections.find((c) => c.id === accountId) ?? null
    : null;
  const brokenAccount = Boolean(selectedConnection?.needs_reconnect);

  const query = useDriveFiles(wsId, { connectionId: accountId });
  const files = query.data?.pages.flatMap((p) => p.files) ?? [];

  // §7.11: `?pick=1` only moves focus to the "Thêm từ…" button, then is removed with `replace`.
  // It never opens the Picker automatically.
  const pickParam = searchParams.get("pick") === "1";
  useEffect(() => {
    if (!pickParam) return;
    addBtnRef.current?.focus();
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("pick");
    const qs = nextParams.toString();
    replace(qs ? `${wsPaths.documents()}?${qs}` : wsPaths.documents());
  }, [pickParam, searchParams, replace, wsPaths]);

  const title = selectedConnection
    ? t("driveLibrary.list.title_account", { email: selectedConnection.google_email })
    : t("driveLibrary.list.title_all");

  const subtitle = selectedConnection
    ? brokenAccount
      ? t("driveLibrary.list.subtitle_broken")
      : t("driveLibrary.list.subtitle_account")
    : t("driveLibrary.list.subtitle_all");

  const addLabel = selectedConnection
    ? t("driveLibrary.list.add_account", { email: selectedConnection.google_email })
    : t("driveLibrary.list.add_all");

  const addDisabled = brokenAccount || !onAddFromDrive;
  const addHint = !onAddFromDrive && !brokenAccount ? t("driveLibrary.list.add_unavailable_hint") : undefined;

  const addButton = (
    <Button
      ref={addBtnRef}
      type="button"
      size="sm"
      aria-disabled={addDisabled || undefined}
      title={addHint}
      onClick={() => {
        if (addDisabled || !onAddFromDrive) return;
        onAddFromDrive(accountId);
      }}
    >
      <Plus aria-hidden className="size-4" />
      {addLabel}
    </Button>
  );

  const connectionById = new Map(connections.map((c) => [c.id, c]));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
          <h1 className="truncate text-title font-semibold">{title}</h1>
          <p className="text-caption text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppLink
            href={settingsIntegrationsHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("driveLibrary.list.manage_connections")}
          </AppLink>
          {addButton}
          {navButton}
        </div>
      </div>

      {query.isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label={t("documents.library.loading")}>
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full rounded-md" />
          ))}
        </div>
      ) : query.isError && files.length === 0 ? (
        <CollectionPageState
          icon={CircleAlert}
          tone="destructive"
          role="alert"
          title={t("driveLibrary.list.error_title")}
          description={t("driveLibrary.list.error_description")}
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RefreshCw aria-hidden className="size-3.5" />
              {t("driveLibrary.list.retry")}
            </Button>
          }
        />
      ) : files.length === 0 ? (
        <CollectionPageState
          icon={FolderOpen}
          title={t("driveLibrary.list.empty_title")}
          description={t("driveLibrary.list.empty_description")}
          actions={
            !brokenAccount ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-disabled={addDisabled || undefined}
                title={addHint}
                onClick={() => {
                  if (addDisabled || !onAddFromDrive) return;
                  onAddFromDrive(accountId);
                }}
              >
                <Plus aria-hidden className="size-4" />
                {addLabel}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full min-w-[44rem] border-collapse text-body">
              <thead>
                <tr className="border-b border-border text-left text-caption text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("driveLibrary.list.columns.name")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("driveLibrary.list.columns.account")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("driveLibrary.list.columns.access")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("driveLibrary.list.columns.used_in")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("driveLibrary.list.columns.tasks_created")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {files.map((file) => {
                  const badge = formatSharingBadge(file, t);
                  const viewerConn = file.viewer_connection_id
                    ? connectionById.get(file.viewer_connection_id)
                    : undefined;
                  const rowNeedsReconnect =
                    file.viewer_access === "connection_lost" || Boolean(viewerConn?.needs_reconnect);
                  const accountEmail = file.viewer_account_email || file.bound_account_email;
                  const createdCount = file.tasks_created?.count ?? 0;

                  return (
                    <tr key={file.id} className="hover:bg-accent/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <DocumentTypeIcon format={file.icon_kind} className="size-6 shrink-0" />
                          <AppLink
                            href={wsPaths.documentsDriveFile(file.id)}
                            className="font-medium text-foreground hover:underline"
                          >
                            {file.name}
                          </AppLink>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-caption text-foreground">{accountEmail}</span>
                          {rowNeedsReconnect ? (
                            onReconnect && file.viewer_connection_id ? (
                              <button
                                type="button"
                                onClick={() => onReconnect(file.viewer_connection_id!)}
                                className="inline-flex items-center gap-1 text-left text-caption text-warning hover:underline"
                              >
                                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                                <span>{t("driveLibrary.list.reconnect_inline")}</span>
                              </button>
                            ) : (
                              <AppLink
                                href={settingsIntegrationsHref}
                                className="inline-flex items-center gap-1 text-caption text-warning hover:underline"
                              >
                                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                                <span>{t("driveLibrary.list.reconnect_inline")}</span>
                              </AppLink>
                            )
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium",
                            badge.className,
                          )}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-caption text-muted-foreground">
                        {formatUsedIn(file, t)}
                      </td>
                      <td className="px-4 py-3 text-caption text-muted-foreground">
                        {createdCount > 0
                          ? t("driveLibrary.list.tasks_created", { count: createdCount })
                          : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {query.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={query.isFetchingNextPage}
                aria-busy={query.isFetchingNextPage || undefined}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? <Spinner aria-hidden role="presentation" /> : null}
                {t(query.isFetchingNextPage ? "driveLibrary.list.loading_more" : "driveLibrary.list.load_more")}
              </Button>
            </div>
          ) : null}

          <p className="text-caption text-muted-foreground">{t("driveLibrary.list.footnote")}</p>
        </>
      )}
    </div>
  );
}
