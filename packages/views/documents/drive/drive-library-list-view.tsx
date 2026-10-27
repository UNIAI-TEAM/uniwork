"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CircleAlert, FolderOpen, Folders, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDriveFiles } from "@uniwork/core/drive-library";
import { groupDriveFilesByFolder } from "@uniwork/core/drive-library/folder-groups";
import { paths } from "@uniwork/core/paths";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Toggle } from "@uniwork/ui/components/ui/toggle";
import { cn } from "@uniwork/ui/lib/utils";
import {
  useDrivePicker,
  type DrivePickerAdapter,
} from "../../integrations/drive-picker";
import { CollectionPageState } from "../../layout/collection-page";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { AppLink, useNavigation } from "../../navigation";
import { DriveLibraryTable } from "./drive-library-table";
import { useDriveFolderGrouping } from "./use-drive-folder-grouping";
import {
  useDriveLibraryConnections,
  type DriveConnectionSummary,
} from "./use-drive-library-connections";

export interface DriveLibraryListViewProps {
  wsId: string;
  accountId: string | null;
  connections?: readonly DriveConnectionSummary[];
  /** Optional mobile sidebar opener button rendered in the header. */
  navButton?: ReactNode;
  /** Optional override for W3 Picker: when omitted, the built-in `useDrivePicker` opens. */
  onAddFromDrive?: (connectionId: string | null) => void;
  /** Optional Google Picker adapter for deterministic testing. */
  pickerAdapter?: DrivePickerAdapter;
}

function DriveLibraryLoadingTable() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="overflow-hidden rounded-lg border border-border bg-background"
      aria-busy="true"
      aria-label={t("documents.library.loading")}
    >
      <table className="w-full table-fixed border-collapse text-body md:table-auto md:min-w-[44rem]">
        <thead>
          <tr className="border-b border-border text-left text-caption text-muted-foreground">
            <th scope="col" className="w-full px-4 py-3 font-medium">
              {t("driveLibrary.list.columns.name")}
            </th>
            <th scope="col" className="hidden whitespace-nowrap px-4 py-3 font-medium md:table-cell">
              {t("driveLibrary.list.columns.account")}
            </th>
            <th scope="col" className="hidden whitespace-nowrap px-4 py-3 font-medium md:table-cell">
              {t("driveLibrary.list.columns.access")}
            </th>
            <th scope="col" className="hidden whitespace-nowrap px-4 py-3 font-medium md:table-cell">
              {t("driveLibrary.list.columns.used_in")}
            </th>
            <th scope="col" className="hidden whitespace-nowrap px-4 py-3 font-medium md:table-cell">
              {t("driveLibrary.list.columns.tasks_created")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, index) => (
            <tr key={index}>
              <td className="w-full max-w-0 px-4 py-3">
                <Skeleton className="h-5 w-48 max-w-full rounded-md" />
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <Skeleton className="h-4 w-36 rounded-md" />
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <Skeleton className="h-5 w-24 rounded-md" />
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <Skeleton className="h-4 w-28 rounded-md" />
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <Skeleton className="h-4 w-16 rounded-md" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 4.1 Documents › Google Drive list screen (`?view=drive[&account=<id>]`, spec §7.6, §7.10, §7.11).
 * Thin gate wrapper: checks `useDriveLibraryConnections` first and mounts `DriveLibraryListBody`
 * (which calls `useDrivePicker` + `useDriveFiles`) only when `driveAvailable && !configWaitForDrive`.
 */
export function DriveLibraryListView(props: DriveLibraryListViewProps) {
  const { wsId, connections: connectionsProp } = props;
  const {
    connections: defaultConnections,
    isLoading: defaultConnectionsLoading,
    driveAvailable,
    configWaitForDrive,
  } = useDriveLibraryConnections(wsId, {
    enabled: connectionsProp === undefined,
  });
  const context = useOptionalWorkspace();
  const { searchParams, replace } = useNavigation();
  const strippedGateRef = useRef(false);

  const wsPaths = paths.workspace(
    context?.workspace.organization_slug || "org",
    context?.workspace.slug || wsId,
  );

  // W8-R1-05: when the Drive connector gate (`DRIVE_CONNECTOR_FLAG` + `drive.available`)
  // is off after config settles, strip `?view=drive` and `&account=` with `replace`
  // (matching `IntegrationsTab` in `packages/views/settings/components/integrations-tab.tsx:122-137`).
  useEffect(() => {
    if (configWaitForDrive || driveAvailable || strippedGateRef.current) {
      return;
    }
    strippedGateRef.current = true;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("view");
    nextParams.delete("account");
    nextParams.delete("pick");
    const qs = nextParams.toString();
    replace(qs ? `${wsPaths.documents()}?${qs}` : wsPaths.documents());
  }, [configWaitForDrive, driveAvailable, replace, searchParams, wsPaths]);

  if (configWaitForDrive) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
        <DriveLibraryLoadingTable />
      </div>
    );
  }

  if (!driveAvailable) {
    return null;
  }

  return (
    <DriveLibraryListBody
      {...props}
      connections={connectionsProp ?? defaultConnections}
      connectionsLoading={connectionsProp === undefined && defaultConnectionsLoading}
    />
  );
}

interface DriveLibraryListBodyProps extends DriveLibraryListViewProps {
  connections: readonly DriveConnectionSummary[];
  connectionsLoading: boolean;
}

function DriveLibraryListBody({
  wsId,
  accountId,
  connections,
  connectionsLoading,
  navButton,
  onAddFromDrive,
  pickerAdapter,
}: DriveLibraryListBodyProps) {
  const { t, i18n } = useTranslation();
  // W8-R3-01: wait for connections only when an `accountId` is selected so the
  // plain "all accounts" list fires its GET immediately without a waterfall.
  const waitForConnections = connectionsLoading && Boolean(accountId);
  const context = useOptionalWorkspace();
  const { searchParams, replace } = useNavigation();
  const addBtnRef = useRef<HTMLButtonElement | null>(null);

  const wsPaths = paths.workspace(
    context?.workspace.organization_slug || "org",
    context?.workspace.slug || wsId,
  );
  const settingsIntegrationsHref = `${wsPaths.settings()}?tab=integrations`;

  const picker = useDrivePicker({
    wsId,
    adapter: pickerAdapter,
  });
  const reconnectHref = picker.reconnectHref;

  const selectedConnection =
    !waitForConnections && accountId
      ? connections.find((c) => c.id === accountId) ?? null
      : null;
  const effectiveAccountId = selectedConnection ? selectedConnection.id : null;
  const brokenAccount = Boolean(selectedConnection?.needs_reconnect);

  const query = useDriveFiles(wsId, {
    connectionId: effectiveAccountId,
    enabled: !waitForConnections,
  });
  const files = query.data?.pages.flatMap((p) => p.files) ?? [];
  const grouping = useDriveFolderGrouping();
  const groups = grouping.groupByFolder ? groupDriveFilesByFolder(files, i18n.language) : null;

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

  const addDisabled = brokenAccount || picker.pending;
  const handleAddFromDrive = () => {
    if (addDisabled) return;
    if (onAddFromDrive) {
      onAddFromDrive(effectiveAccountId);
      return;
    }
    picker.open(effectiveAccountId ? { connectionId: effectiveAccountId } : {});
  };

  const addButton = (
    <Button
      ref={addBtnRef}
      type="button"
      size="sm"
      className="min-w-0 max-w-full"
      title={addLabel}
      aria-disabled={addDisabled || undefined}
      onClick={handleAddFromDrive}
    >
      <Plus aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{addLabel}</span>
    </Button>
  );

  const connectionById = new Map(connections.map((c) => [c.id, c]));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-72 items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-title font-semibold">{title}</h1>
            <p className="text-caption text-muted-foreground">{subtitle}</p>
          </div>
          {navButton ? <div className="shrink-0">{navButton}</div> : null}
        </div>
        <div className="flex min-w-0 basis-full flex-wrap items-center justify-start gap-2 sm:basis-auto">
          {brokenAccount ? (
            <AppLink
              href={reconnectHref}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "gap-1.5 text-warning",
              )}
            >
              <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
              <span>{t("driveLibrary.list.reconnect_inline")}</span>
            </AppLink>
          ) : null}
          <AppLink
            href={settingsIntegrationsHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("driveLibrary.list.manage_connections")}
          </AppLink>
          {addButton}
        </div>
      </div>

      {waitForConnections || query.isPending ? (
        <DriveLibraryLoadingTable />
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
                onClick={handleAddFromDrive}
              >
                <Plus aria-hidden className="size-4" />
                {addLabel}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="flex justify-end">
            <Toggle
              variant="outline"
              size="sm"
              pressed={grouping.groupByFolder}
              onPressedChange={grouping.setGroupByFolder}
              title={t("driveLibrary.list.group.toggle_hint")}
              className="pointer-coarse:min-h-11"
            >
              <Folders aria-hidden className="size-4" />
              {t("driveLibrary.list.group.toggle")}
            </Toggle>
          </div>
          <DriveLibraryTable
            files={files}
            groups={groups}
            connectionById={connectionById}
            reconnectHref={reconnectHref}
            fileHref={wsPaths.documentsDriveFile}
            isCollapsed={grouping.isCollapsed}
            onToggleGroup={grouping.toggleCollapsed}
          />

          {query.isFetchNextPageError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-caption text-destructive"
            >
              <span>{t("driveLibrary.list.error_title")}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void query.fetchNextPage()}
              >
                <RefreshCw aria-hidden className="size-3.5" />
                {t("driveLibrary.list.retry")}
              </Button>
            </div>
          ) : query.hasNextPage ? (
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
      {picker.dialogs}
    </div>
  );
}
