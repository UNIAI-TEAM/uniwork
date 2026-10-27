"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { FolderPlus, FolderTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useAuthStore } from "@uniwork/core/auth";
import { useDocument, useDocumentLimits } from "@uniwork/core/documents/hooks";
import { useFavoriteDocument, useUnfavoriteDocument } from "@uniwork/core/documents/hooks-favorites";
import { useDownloadDocumentSource, useEnsureMyFolder } from "@uniwork/core/documents/hooks-library";
import { paths } from "@uniwork/core/paths";
import { canCreateInsideFolder, canEditDocument, useCurrentMember } from "@uniwork/core/permissions";
import { isMyFolder } from "@uniwork/core/types/document";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import { OfficeHomeLaunch, type OfficeHomeLaunchProps } from "../office/office-home-launch";
import { DocumentsDropOverlay } from "./documents-drop-overlay";
import { DocumentsGateState, useDocumentsGate } from "./documents-gate";
import { isParentWorkspaceShared, useCreateOfType } from "./documents-create";
import { DocumentsCollectionHeader, DocumentsFolderInvalidState, DocumentsHomeHeader, DocumentsHomeNote } from "./documents-home-header";
import { DocumentsLibraryList } from "./documents-library-list";
import type { DocumentTypeFilter } from "./library-rows";
import { useCollapsedGroups } from "./doclist/group-state";
import { folderNameLookup } from "./doclist/live-screen";
import { docMemberLookup } from "./doclist/screen-cells";
import { useDocListBulkCommands } from "./doclist/use-bulk-commands";
import type { LibraryDesktopOpen, LibraryRowHandlers } from "./documents-library-row";
import { LibraryToolbar } from "./documents-library-toolbar";
import { DocumentsSections } from "./documents-folders-grid";
import { RecentContinue } from "./documents-recent-continue";
import { DocumentsScreenHead } from "./documents-screen-head";
import { DocumentsShelvedView } from "./documents-shelved-view";
import { DocumentsTrashView } from "./documents-trash-view";
import { DocumentsSidebar, DocumentsSidebarSheet, type LibraryView } from "./documents-sidebar";
import { downloadSourceFile } from "./download-source-file";
import { sourceParentPath } from "./source-links";
import { useDocumentsLibrary } from "./use-documents-library";
import { useDocumentsUploads } from "./use-documents-uploads";
import type { OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { useSourceOfficeViewer } from "./source-office-viewer";
import { useLibraryRowDialogs } from "./use-library-row-dialogs";
import { useLibraryRowFileCommands } from "./use-library-row-file-commands";
import { shouldRetryFolderDetail } from "./use-tree-reveal";
import { DocumentsSearchBox } from "./documents-search-box";
import { useDocumentsSearchView } from "./search-view-state";
import { useTrashActions } from "./use-trash-actions";
import { useShelvedActions } from "./use-shelved-actions";
import { buildDocumentsViewUrl, sameDocumentsView, viewFromSearchParams } from "./documents-view-url";
import { buildDocumentsDriveBranch, type DriveConnectionSummary } from "./drive/documents-drive-branch";
import { NameDriveFolderHost, useNameFolderLauncher } from "./drive/name-drive-folder-host";

// Thùng rác has no filter bar: its library reads no type.
const NO_TYPES: DocumentTypeFilter[] = [];

export interface DocumentsPageViewProps {
  wsId: string;
  /** Opens the document the user created, uploaded or picked from a list. */
  onOpen: (documentId: string) => void;
  /** Host wiring of "Open in UniWork Office" per file row; without it rows have no app action. */
  desktopOpen?: LibraryDesktopOpen;
  /** Host wiring of the header "Open UniWork Office" (the app, no document); absent hides it. */
  officeHome?: OfficeHomeLaunchProps;
  /** The pinned build of a genoffice module ("" = not installed); without it Office sources download instead of opening view-only (UNI-1869). */
  officeFrameVersion?: (module: OfficeModule) => string;
  /** Optional override for the caller's connected Google Drive accounts (defaults to useDriveLibraryConnections). */
  driveConnections?: readonly DriveConnectionSummary[];
  /** Seam for W3 Picker from the Google Drive library screen (`?view=drive`). */
  onAddFromDrive?: (connectionId: string | null) => void;
}

/**
 * `/documents` — the Documents home (TRASH-A3 boards, 2026-10-16): at home and
 * in a folder a header row, folder cards and the documents table; Trash and
 * Lưu trữ wrap the same table with their own heading; Recent / Starred / Shared / Elsewhere keep the
 * collection header and the library table. Every row is a server answer;
 * create, upload and save await the server.
 */
export function DocumentsPageView({ wsId, onOpen, desktopOpen, officeHome, officeFrameVersion, driveConnections, onAddFromDrive }: DocumentsPageViewProps) {
  const { t } = useTranslation();
  const { gate, retry: retryGate } = useDocumentsGate();
  const enabled = gate === "on";
  const limits = useDocumentLimits({ enabled });
  const context = useOptionalWorkspace();
  const orgId = context?.workspace.organization_id ?? "";
  const { push, searchParams } = useNavigation();

  const searchKey = searchParams.toString();
  const [lastSearchKey, setLastSearchKey] = useState(searchKey);
  const [view, setView] = useState<LibraryView>(() => viewFromSearchParams(searchParams));
  if (searchKey !== lastSearchKey) {
    setLastSearchKey(searchKey);
    setView(viewFromSearchParams(searchParams));
  }
  const [types, setTypes] = useState<DocumentTypeFilter[]>([]);
  const [navOpen, setNavOpen] = useState(false);

  // The trashed document a notification pointed at is scrolled to and focused once per id, the first time its row shows.
  const focusId = searchParams.get("focus");
  const appliedFocus = useRef<string | null>(null);
  // A row present on the first render takes the keyboard; one that only comes in after the user pressed Load more for that focus id is scrolled to and highlighted, never focused.
  const pagedByUser = useRef<string | null>(null);
  const claimFocus = useCallback((documentId: string) => {
    if (appliedFocus.current === documentId) return null;
    appliedFocus.current = documentId;
    const mode = pagedByUser.current === documentId ? "reveal" : "focus";
    pagedByUser.current = null;
    return mode;
  }, []);

  const urlFolderId = searchParams.get("folder") || null;
  const folderId = view.kind === "home" ? urlFolderId : null;
  const wsPaths = useMemo(
    () => paths.workspace(context?.workspace.organization_slug || "org", context?.workspace.slug || wsId),
    [context?.workspace.organization_slug, context?.workspace.slug, wsId],
  );

  // Every list screen but Thùng rác shows the filter bar (UNI-2045 W10).
  const members = useMembers(enabled ? wsId : "");
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.user_id, m.display_name])), [members.data]);
  const library = useDocumentsLibrary({
    wsId,
    orgId,
    enabled,
    view,
    folderId,
    types: view.kind === "archived" ? NO_TYPES : types,
    editorNames: names,
  });
  const folder = useDocument(wsId, folderId ?? "", {
    enabled: enabled && !!folderId,
    retry: shouldRetryFolderDetail,
  });
  const ensureMyFolder = useEnsureMyFolder(wsId);
  const creator = useCreateOfType(wsId, onOpen);
  const downloadSource = useDownloadDocumentSource(wsId);
  // The row-menu download (and the viewer's fallback when no module frame can
  // host the file): one code path for both, named for the file.
  const downloadFile = (sourceId: string) =>
    downloadSourceFile({
      sourceId,
      fetchBlob: (id) => downloadSource.mutateAsync({ sourceId: id }),
      fileName: (id) => {
        const name = library.state.rows.find((row) => row.type === "source" && row.source.id === id);
        return name?.type === "source" ? name.source.name : "";
      },
      failedCopy: t("documents.home.row.download_failed"),
    });

  const officeViewer = useSourceOfficeViewer({
    wsId,
    organizationId: context?.workspace.organization_id,
    frameVersion: officeFrameVersion ?? (() => ""),
    onDownload: (source) => downloadFile(source.id),
  });
  const favorite = useFavoriteDocument();
  const unfavorite = useUnfavoriteDocument();

  const rawFolderDoc = folder.data ?? null;
  const folderInvalid =
    Boolean(folderId) &&
    !folder.isPending &&
    (folder.isError ||
      rawFolderDoc === null ||
      rawFolderDoc.kind !== "folder" ||
      Boolean(rawFolderDoc.archived_at) ||
      rawFolderDoc.workspace_id !== wsId);
  // At the workspace root every member may create (DocumentService.CreatePage
  // asks RequireMember only); inside a folder the folder's own level decides,
  // and a viewer of it sees no create control at all.
  const folderDoc = !folderInvalid && rawFolderDoc?.id === folderId ? rawFolderDoc : null;
  const myFolderLabel = t("documents.home.my_folder.label");
  const myFolderId = useMemo(
    () => library.tree.find((node) => isMyFolder(node))?.id ?? ensureMyFolder.data?.id ?? (folderDoc && isMyFolder(folderDoc) ? folderDoc.id : null),
    [library.tree, ensureMyFolder.data?.id, folderDoc],
  );
  const openFolderTitle = folderDoc ? (isMyFolder(folderDoc) ? myFolderLabel : folderDoc.title) : undefined;
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const permissionCtx = { userId: context?.user.id ?? userId, orgRole: null, wsRole: useCurrentMember(enabled ? wsId : "").role };
  // Rename, move and trash of the open folder keep the edit rule; creating inside it is wider on a
  // workspace folder (UNI-2055 W3/W4), so the two are asked apart.
  const canEditFolder = !folderId || (folderDoc !== null && canEditDocument(folderDoc, permissionCtx).allowed);
  const canCreate = !folderId || (folderDoc !== null && canCreateInsideFolder(folderDoc, permissionCtx).allowed);
  const parentForCreate = view.kind === "home" ? folderId : null;
  const parentShared = parentForCreate !== null && isParentWorkspaceShared(folderDoc, library.docById.get(parentForCreate));

  const uploads = useDocumentsUploads({
    wsId,
    limits,
    canUpload: enabled && canCreate && !folderInvalid,
    parentId: parentForCreate,
    folderDoc,
    folderTitle: openFolderTitle,
    tree: library.tree,
    myFolderId,
    resolveRootParent: async () => myFolderId ?? (await ensureMyFolder.mutateAsync()).id,
    parentShared,
    onOpen,
    onOpenFolder: (id) => goHome({ kind: "home" }, id),
    officeHome,
  });

  const rowDialogs = useLibraryRowDialogs({ wsId, tree: library.tree, folderId, folderTitle: openFolderTitle, folderRow: folderDoc });
  const searchView = useDocumentsSearchView({
    wsId,
    enabled,
    view,
    folderId,
    folderPending: folder.isPending,
    types: view.kind === "archived" ? NO_TYPES : types,
    library,
    myFolderId,
    myFolderLabel,
    onNavigateFolder: (id) => goHome({ kind: "home" }, id),
    onClearLibraryFilters: () => {
      setTypes([]);
      library.clearFilters();
    },
  });
  const {
    search,
    searching,
    searchState,
    state,
    activeDocById,
    activeRows,
    metaFiltered,
    filteredBy,
    tableRows,
    listScreen,
    groupScreen,
    groups,
    subfolders,
    listLoading,
    rootEmpty,
    cards,
    hideDocuments,
  } = searchView;
  const fileCommands = useLibraryRowFileCommands({
    wsId, orgId, documentHref: wsPaths.document, onOpen, docById: activeDocById, desktopOpen,
  });
  const trashActions = useTrashActions({ wsId, rows: library.state.rows });
  const shelvedActions = useShelvedActions({ wsId, rows: activeRows });
  // The bulk bar (UNI-2045 W9) on every list screen but the sources view; a
  // new folder, view or filter starts a fresh selection.
  const bulkCommands = useDocListBulkCommands({ wsId, tree: library.tree, onDownloadOne: fileCommands.onDownload });
  const selectionKey = [wsId, view.kind, view.kind === "sources" ? (view.source ?? "") : "", folderId ?? "", types.join(","), library.activity, library.editor, library.updated, library.shelvedBy ?? ""].join("|");
  // Move and archive sit on the rows of this workspace's own lists for
  // people who may change the open folder; the server decides per document.
  // Lưu trữ joins the same set (U-4: manage-only at the menu item itself).
  const rowCommands = canCreate && (view.kind === "home" || view.kind === "recent" || view.kind === "starred" || view.kind === "shared" || view.kind === "sharedByMe");

  const member = useMemo(() => docMemberLookup(members.data), [members.data]);
  const goHome = (next: LibraryView, nextFolder: string | null = null) => {
    if (next.kind !== view.kind) {
      // A screen change starts with no filter; none carries over unseen.
      setTypes([]);
      library.clearFilters();
    }
    setView(next);
    setNavOpen(false);
    const targetFolder = next.kind === "home" ? nextFolder : null;
    const currentView = viewFromSearchParams(searchParams);
    const sameDestination = targetFolder === urlFolderId && sameDocumentsView(currentView, next);
    if (!sameDestination) {
      push(buildDocumentsViewUrl(wsPaths, next, targetFolder));
    }
  };

  const newRootFolder = async (title?: string): Promise<boolean> => {
    const id = await creator.newFolder(null, title);
    if (id) {
      goHome({ kind: "home" }, id);
      return true;
    }
    return false;
  };
  const openMyFolder = () => {
    if (myFolderId) return goHome({ kind: "home" }, myFolderId);
    if (ensureMyFolder.isPending) return;
    void ensureMyFolder.mutateAsync().then(
      (doc) => goHome({ kind: "home" }, doc.id),
      () => toast.error(t("documents.home.my_folder.open_failed")),
    );
  };
  const handlers: LibraryRowHandlers = {
    onOpen: fileCommands.openDocument,
    onFolder: searchView.openFolderFromList,
    onGoToSource: (row) => {
      const target = context ? sourceParentPath(paths.workspace(context.workspace.organization_slug, context.workspace.slug), row.source.parent) : null;
      if (target) push(target);
    },
    // UNI-1869: an Office source opens view-only in its module frame; no module
    // or no installed build takes the download the click always offered.
    onViewSource: (source) => { if (!officeViewer.open(source)) downloadFile(source.id); },
    onDownloadSource: downloadFile,
    onSaveSource: rowDialogs.onSaveSource,
    onNewSubfolder: rowCommands ? rowDialogs.onNewSubfolder : undefined,
    canCreateInside: (doc) => canCreateInsideFolder(doc, permissionCtx).allowed,
    onRename: rowCommands ? rowDialogs.onRename : undefined,
    onMove: rowCommands ? rowDialogs.onMove : undefined,
    onArchive: rowCommands ? rowDialogs.onArchive : undefined,
    // Any reader may open Share from a row (UNI-2009); it is not gated by canCreate like the commands above.
    onShare: rowDialogs.onShare,
    onShareContents: rowDialogs.onShareContents,
    onShelve: rowCommands ? (doc) => shelvedActions.onShelve(doc) : undefined,
    // Link and download are reads, offered to any reader; the copy needs edit, which the menu checks per row.
    onCopyLink: fileCommands.onCopyLink,
    onDownload: fileCommands.onDownload,
    onDuplicate: rowCommands ? fileCommands.onDuplicate : undefined,
    onToggleStar: orgId
      ? (documentId, starred) => {
          const op = starred ? unfavorite : favorite;
          void op.mutateAsync(documentId).catch((error: unknown) => toast.error(apiErrorMessage(error) ?? t("documents.home.row.star_failed")));
        }
      : undefined,
    isStarred: (documentId) => library.starredIds.has(documentId),
    member,
    personName: (userId, kind) => names.get(userId) ?? (kind === "agent" ? t("documents.home.editor_agent") : null),
    locationName: folderNameLookup(library.tree, t("documents.home.my_folder.label")),
    searchPath: searchState?.searchPath,
    desktopOpen,
  };

  const homeView = view.kind === "home";
  const collapse = useCollapsedGroups(groupScreen);
  const { renderDriveView, sectionZoneProps, sidebarDriveProps } = buildDocumentsDriveBranch({ wsId, view, driveConnections, onAddFromDrive, zoneProps: uploads.zoneProps });
  const emptyCopy = homeView
    ? {
        title: folderId ? t("documents.home.empty.folder_title") : t(`documents.home.empty.${rootEmpty}title`),
        description: canCreate ? t(`documents.home.empty.${rootEmpty}description`) : t("documents.home.empty.view_only"),
        actions:
          folderId && canCreate ? (
            <Button type="button" variant="outline" size="sm" onClick={() => rowDialogs.onCreateFolder()}>
              <FolderPlus aria-hidden className="size-3.5" />
              {t("documents.home.folders.create_title")}
            </Button>
          ) : undefined,
      }
    : { title: t(`documents.home.empty.${view.kind === "sharedByMe" ? "shared_by_me" : view.kind}_title`), description: t(`documents.home.empty.${view.kind === "sharedByMe" ? "shared_by_me" : view.kind}_description`) };

  const nameDriveFolder = useNameFolderLauncher();
  const sidebar = {
    wsId,
    view,
    folderId,
    myFolderId,
    myFolderPending: ensureMyFolder.isPending,
    starredCount: library.starredCount,
    sourcesAvailable: library.sourcesAvailable,
    canCreate: !folderId || canCreate,
    newFolderPending: creator.folderPending,
    accessReportHref: wsPaths.documentsAccessReport(),
    ...sidebarDriveProps,
    onNameDriveFolder: (folder: { id: string }, connectionId: string) => nameDriveFolder.launch(folder.id, connectionId),
    onView: (next: LibraryView) => goHome(next),
    onFolder: (id: string) => goHome({ kind: "home" }, id),
    onMyFolder: openMyFolder,
    onNewFolder: (title?: string) => newRootFolder(title),
  };
  const createProps = {
    pending: creator.pending,
    unavailable: creator.unavailable,
    recentType: creator.lastType,
    onCreate: (type: Parameters<typeof creator.create>[0]) => void creator.create(type, parentForCreate),
    onUpload: uploads.openUpload,
    onUploadFolder: uploads.openFolderUpload,
    onNewFolder: parentForCreate ? rowDialogs.onCreateFolder : undefined,
  };

  const navButton = (
    <Button type="button" variant="outline" size="sm" className="shrink-0 xl:hidden" onClick={() => setNavOpen(true)}>
      <FolderTree aria-hidden className="size-3.5" />
      {t("documents.home.sidebar.open")}
    </Button>
  );
  const hostActions = officeHome ? <OfficeHomeLaunch {...officeHome} /> : null;
  // Home, folder and Trash carry their own h1 (the boards), and so do the list
  // screens with the shared head, Lưu trữ included (UNI-2045 W14); only the
  // gate states keep the collection header.
  const screenHead = !homeView && view.kind !== "archived" && view.kind !== "drive";
  const collectionHeader = gate !== "on";
  const libraryList = (
    <DocumentsLibraryList
      groups={groups}
      loading={listLoading}
      failure={state.failure}
      filteredBy={filteredBy}
      metaFiltered={metaFiltered}
      cardsShown={canCreate && homeView && !searchState}
      emptyFiltered={searchView.emptyFiltered}
      clearFiltersLabel={searchView.clearFiltersLabel}
      hasMore={state.hasMore}
      loadingMore={state.loadingMore}
      onLoadMore={state.loadMore}
      onRetry={state.refetch}
      onClearFilters={searchView.clearFiltersOrSearch}
      handlers={handlers}
      sort={library.sortControl}
      screen={listScreen}
      collapse={collapse}
      selectable={view.kind !== "sources"}
      bulk={bulkCommands.bulk}
      selectionKey={selectionKey}
      empty={emptyCopy}
    />
  );
  const searchBox = <DocumentsSearchBox search={search} />;
  const toolbar = {
    types,
    onTypes: setTypes,
    editor: library.editor,
    onEditor: library.setEditor,
    members: members.data,
    updated: library.updated,
    onUpdated: library.setUpdated,
    search: searchBox,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {collectionHeader ? <DocumentsCollectionHeader /> : null}

      {gate !== "on" ? (
        <DocumentsGateState gate={gate} retry={retryGate} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-64 shrink-0 border-r border-border xl:flex">
            <DocumentsSidebar {...sidebar} className="w-full" />
          </aside>
          <section
            className="relative min-h-0 min-w-0 flex-1 overflow-y-auto"
            aria-label={t("documents.page.title")}
            {...sectionZoneProps}
          >
            {homeView ? (
              <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
                <DocumentsHomeHeader
                  wsId={wsId}
                  folderDoc={folderDoc}
                  canRename={canEditFolder}
                  myFolderId={myFolderId}
                  onRoot={() => goHome({ kind: "home" })}
                  onFolder={(id) => goHome({ kind: "home" }, id)}
                  folderHandlers={handlers}
                  onAccessReport={(id) => push(wsPaths.documentsAccessReport(id))}
                  canCreate={canCreate && !folderInvalid}
                  create={createProps}
                  actions={<>{hostActions}{navButton}</>}
                />
              </div>
            ) : screenHead ? (
              <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
                <DocumentsScreenHead view={view} actions={navButton} />
              </div>
            ) : null}
            {folderInvalid ? (
              <div className="@container mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
                {searchBox}
                {searching ? (
                  libraryList
                ) : (
                  <DocumentsFolderInvalidState backHref={wsPaths.documents()} onBack={() => setView({ kind: "home" })} />
                )}
              </div>
            ) : renderDriveView(navButton) ?? (view.kind === "archived" ? (
              <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 sm:px-6">
                <div className="flex justify-end xl:hidden">{navButton}</div>
                <DocumentsTrashView
                  rows={state.rows}
                  loading={state.loading}
                  failure={state.failure}
                  onRetry={state.refetch}
                  actions={trashActions}
                  handlers={handlers}
                  bulk={bulkCommands.bulk}
                  selectionKey={selectionKey}
                  collapse={collapse}
                  focusId={focusId}
                  claimFocus={claimFocus}
                  hasMore={state.hasMore}
                  loadingMore={state.loadingMore}
                  onLoadMore={() => {
                    pagedByUser.current = focusId;
                    state.loadMore();
                  }}
                />
              </div>
            ) : (
              <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
                {homeView && canCreate ? <DocumentsHomeNote create={folderId ? null : createProps} /> : null}
                {!homeView && cards.length > 0 ? <RecentContinue cards={cards} onOpen={fileCommands.openDocument} /> : null}
                {view.kind === "shelved" ? (
                  <DocumentsShelvedView
                    library={library}
                    types={types}
                    onTypes={setTypes}
                    members={members.data}
                    handlers={handlers}
                    bulk={bulkCommands.bulk}
                    selectionKey={selectionKey}
                    search={searchBox}
                    searchList={searchState}
                    actions={{
                      onUnshelve: shelvedActions.onUnshelve,
                      onTrash: (doc) => rowDialogs.onArchive(doc),
                      isUnshelving: shelvedActions.isUnshelving,
                    }}
                  />
                ) : (
                  <LibraryToolbar
                    {...toolbar}
                    {...(view.kind === "recent" ? { activity: library.activity, onActivity: library.setActivity } : {})}
                    className={homeView ? "border-t border-border pt-4" : undefined}
                  />
                )}
                {view.kind === "shelved" ? null : homeView ? (
                  <>
                    <DocumentsSections
                      folderTitle={!searching && folderId ? "documents.home.sections.subfolders" : "documents.home.sections.folders"}
                      folders={subfolders}
                      documentsCount={tableRows.length}
                      hideDocuments={hideDocuments}
                      grid={{
                        docById: activeDocById,
                        handlers,
                        onOpenFolder: searchView.openFolderFromList,
                      }}
                    >
                      {libraryList}
                    </DocumentsSections>
                    {canCreate && !listLoading && tableRows.length > 0 ? (
                      <p className="text-caption text-muted-foreground">{t("documents.home.drop_hint")}</p>
                    ) : null}
                  </>
                ) : (
                  libraryList
                )}
              </div>
            ))}
            {uploads.dropActive ? <DocumentsDropOverlay /> : null}
          </section>
        </div>
      )}

      <DocumentsSidebarSheet open={navOpen} onOpenChange={setNavOpen} {...sidebar} />

      {uploads.dialogs}

      {nameDriveFolder.request ? <NameDriveFolderHost wsId={wsId} request={nameDriveFolder.request} /> : null}

      {officeViewer.dialog}

      {trashActions.dialog}

      {shelvedActions.dialog}

      {bulkCommands.dialogs}

      {rowDialogs.dialogs}
      {fileCommands.dialogs}
    </div>
  );
}
