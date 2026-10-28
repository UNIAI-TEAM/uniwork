"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, FolderOpen, Pencil, Plus, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDriveFiles } from "@uniwork/core/drive-library";
import { useDriveAccountFolders } from "@uniwork/core/drive-library/use-account-folders";
import {
  DRIVE_ACCOUNT_PARAM,
  DRIVE_FOLDER_PARAM,
  DRIVE_NAME_FOLDER_PARAM,
  parseDriveNameFolderRequest,
  paths,
} from "@uniwork/core/paths";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@uniwork/ui/components/ui/breadcrumb";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import {
  useDrivePicker,
  type DrivePickerAdapter,
} from "../../integrations/drive-picker";
import { CollectionPageState } from "../../layout/collection-page";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { AppLink, useNavigation } from "../../navigation";
import { fold } from "../../settings/components/member-search";
import { driveFolderLabel } from "./drive-folder-label";
import { DriveLibraryLoadingTable } from "./drive-library-loading-table";
import { DriveLibrarySearch } from "./drive-library-search";
import { DriveLibraryTable } from "./drive-library-table";
import { NameDriveFolderHost, useNameFolderLauncher } from "./name-drive-folder-host";
import {
  useDriveLibraryConnections,
  type DriveConnectionSummary,
} from "./use-drive-library-connections";

export interface DriveLibraryListViewProps {
  wsId: string;
  accountId: string | null;
  /** Drive folder inside the selected account (`driveFolder` search param); an unknown id shows the account. */
  folderId?: string | null;
  connections?: readonly DriveConnectionSummary[];
  /** Optional mobile sidebar opener button rendered in the header. */
  navButton?: ReactNode;
  /** Optional override for W3 Picker: when omitted, the built-in `useDrivePicker` opens. */
  onAddFromDrive?: (connectionId: string | null) => void;
  /** Optional Google Picker adapter for deterministic testing. */
  pickerAdapter?: DrivePickerAdapter;
}

/**
 * 4.1 Documents › Google Drive list screen (`?view=drive[&account=<id>[&driveFolder=<id>]]`, spec §7.6, §7.10, §7.11).
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
    nextParams.delete(DRIVE_ACCOUNT_PARAM);
    nextParams.delete(DRIVE_FOLDER_PARAM);
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
  folderId = null,
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

  const accountScoped = effectiveAccountId !== null;
  const rootQuery = useDriveFiles(wsId, {
    connectionId: null,
    enabled: !waitForConnections && !accountScoped,
  });
  const account = useDriveAccountFolders(wsId, effectiveAccountId, {
    enabled: !waitForConnections,
    locale: i18n.language,
  });
  // The node on show: the Google Drive root (all accounts), one account (folder rows, then the
  // files without a folder) or one folder of it. An unknown folder id falls back to the account.
  const selectedFolder = accountScoped && folderId ? account.folders.find((f) => f.id === folderId) ?? null : null;
  const nodeFolders = accountScoped && !selectedFolder ? account.folders : [];
  // The node's files come from the server's folder filter: the folder's own files, or `none` (the
  // account's files without a known parent). It waits for the folder list so an unknown folder id
  // never fires a query of its own.
  const foldersReady = accountScoped && !account.isPending && !account.isError;
  const nodeQuery = useDriveFiles(wsId, {
    connectionId: effectiveAccountId,
    driveFolderId: selectedFolder ? selectedFolder.id : "none",
    enabled: !waitForConnections && foldersReady,
  });
  const nodeFiles = (accountScoped ? nodeQuery : rootQuery).data?.pages.flatMap((p) => p.files) ?? [];
  const isPending =
    waitForConnections || (accountScoped ? account.isPending || (foldersReady && nodeQuery.isPending) : rootQuery.isPending);
  const isError = accountScoped
    ? account.isError || (nodeQuery.isError && nodeFiles.length === 0)
    : rootQuery.isError && nodeFiles.length === 0;
  const refetch = () => {
    if (!accountScoped) void rootQuery.refetch();
    else if (account.isError) account.refetch();
    else void nodeQuery.refetch();
  };

  const nodeKey = `${effectiveAccountId ?? ""}|${selectedFolder?.id ?? ""}`;
  const [searchState, setSearchState] = useState({ key: nodeKey, text: "" });
  const search = searchState.key === nodeKey ? searchState.text : "";
  const foldedSearch = fold(search);
  // Account view with a query: flat search over the files of the whole account (its own list, paged
  // with Load more), folder rows hidden. The query only runs while a search is typed.
  const flatAccountSearch = foldedSearch !== "" && accountScoped && !selectedFolder;
  const accountSearchQuery = useDriveFiles(wsId, {
    connectionId: effectiveAccountId,
    enabled: !waitForConnections && flatAccountSearch,
  });
  const accountSearchFiles = accountSearchQuery.data?.pages.flatMap((p) => p.files) ?? [];
  const searchLoading = flatAccountSearch && accountSearchQuery.isPending;
  const searchFailed = flatAccountSearch && accountSearchQuery.isError && accountSearchFiles.length === 0;
  const shownFolders = flatAccountSearch ? [] : nodeFolders;
  const searchedFiles = flatAccountSearch ? accountSearchFiles : nodeFiles;
  const shownFiles = foldedSearch ? searchedFiles.filter((f) => fold(f.name).includes(foldedSearch)) : nodeFiles;
  const nodeEmpty = nodeFolders.length === 0 && nodeFiles.length === 0;
  // The list whose next page the Load more control fetches.
  const pager = flatAccountSearch ? accountSearchQuery : accountScoped ? nodeQuery : rootQuery;

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

  // "Name this folder" (contract v3 item 3): the header action of an unnamed folder, and the `nameFolder=1`
  // request the desktop app hands off with. The request is dropped from the URL once it was looked at,
  // so the Picker opens at most once.
  const { request: nameRequest, launch: launchName } = useNameFolderLauncher();
  const canNameFolder = selectedFolder !== null && selectedFolder.name === null && !brokenAccount;
  const nameRequested = parseDriveNameFolderRequest(searchParams);
  const nameSettled = !waitForConnections && (!accountScoped || account.isError || !account.isPending);
  const nameHandledRef = useRef(false);
  useEffect(() => {
    if (!nameRequested) {
      nameHandledRef.current = false;
      return;
    }
    // The ref holds the request until the URL has really dropped it (a navigation commits later).
    if (!nameSettled || nameHandledRef.current) return;
    nameHandledRef.current = true;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete(DRIVE_NAME_FOLDER_PARAM);
    replace(`${wsPaths.documents()}?${nextParams.toString()}`);
    if (canNameFolder && effectiveAccountId) launchName(selectedFolder.id, effectiveAccountId);
  }, [nameRequested, nameSettled, canNameFolder, effectiveAccountId, selectedFolder, launchName, searchParams, replace, wsPaths]);

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

  const errorState = (onRetry: () => void) => (
    <CollectionPageState
      icon={CircleAlert}
      tone="destructive"
      role="alert"
      title={t("driveLibrary.list.error_title")}
      description={t("driveLibrary.list.error_description")}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden className="size-3.5" />
          {t("driveLibrary.list.retry")}
        </Button>
      }
    />
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-72 items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            {selectedConnection && selectedFolder ? (
              <>
                <h1 className="sr-only">{driveFolderLabel(selectedFolder, t)}</h1>
                <Breadcrumb aria-label={t("driveLibrary.list.breadcrumb_label")}>
                  <BreadcrumbList className="text-title tracking-normal">
                    <BreadcrumbItem>
                      <BreadcrumbLink render={<AppLink href={wsPaths.documentsDrive()} />}>
                        {t("driveLibrary.list.title_all")}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="min-w-0">
                      <BreadcrumbLink
                        render={<AppLink href={wsPaths.documentsDrive(selectedConnection.id)} />}
                        className="truncate"
                      >
                        {selectedConnection.google_email}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="min-w-0">
                      <BreadcrumbPage className="truncate font-semibold">
                        {driveFolderLabel(selectedFolder, t)}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </>
            ) : (
              <h1 className="truncate text-title font-semibold">{title}</h1>
            )}
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
          {canNameFolder && effectiveAccountId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => launchName(selectedFolder.id, effectiveAccountId)}
            >
              <Pencil aria-hidden className="size-3.5" />
              {t("driveLibrary.folder.name_action")}
            </Button>
          ) : null}
          {addButton}
        </div>
      </div>

      {isPending ? (
        <DriveLibraryLoadingTable />
      ) : isError ? (
        errorState(refetch)
      ) : nodeEmpty ? (
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
          <DriveLibrarySearch value={search} onChange={(text) => setSearchState({ key: nodeKey, text })} />
          {searchLoading ? (
            <DriveLibraryLoadingTable />
          ) : searchFailed ? (
            errorState(() => void accountSearchQuery.refetch())
          ) : shownFolders.length === 0 && shownFiles.length === 0 ? (
            <CollectionPageState
              icon={Search}
              title={t("driveLibrary.list.no_results_title")}
              description={t("driveLibrary.list.no_results_description", { query: search.trim() })}
            />
          ) : (
            <DriveLibraryTable
              folders={shownFolders}
              files={shownFiles}
              connectionById={connectionById}
              reconnectHref={reconnectHref}
              fileHref={wsPaths.documentsDriveFile}
              folderHref={(id) => wsPaths.documentsDrive(effectiveAccountId, id)}
            />
          )}

          {pager.isFetchNextPageError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-caption text-destructive"
            >
              <span>{t("driveLibrary.list.error_title")}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void pager.fetchNextPage()}>
                <RefreshCw aria-hidden className="size-3.5" />
                {t("driveLibrary.list.retry")}
              </Button>
            </div>
          ) : pager.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pager.isFetchingNextPage}
                aria-busy={pager.isFetchingNextPage || undefined}
                onClick={() => void pager.fetchNextPage()}
              >
                {pager.isFetchingNextPage ? <Spinner aria-hidden role="presentation" /> : null}
                {t(pager.isFetchingNextPage ? "driveLibrary.list.loading_more" : "driveLibrary.list.load_more")}
              </Button>
            </div>
          ) : null}

          <p className="text-caption text-muted-foreground">{t("driveLibrary.list.footnote")}</p>
        </>
      )}
      {picker.dialogs}
      {nameRequest ? (
        <NameDriveFolderHost wsId={wsId} request={nameRequest} adapter={pickerAdapter} />
      ) : null}
    </div>
  );
}
