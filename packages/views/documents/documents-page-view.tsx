"use client";

import { useMemo, useState } from "react";
import { CircleAlert, FolderPlus, FolderTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useAuthStore } from "@uniwork/core/auth";
import { useDocument, useDocumentLimits } from "@uniwork/core/documents/hooks";
import { useFavoriteDocument, useUnfavoriteDocument } from "@uniwork/core/documents/hooks-favorites";
import { useDownloadDocumentSource, useEnsureMyFolder } from "@uniwork/core/documents/hooks-library";
import { paths } from "@uniwork/core/paths";
import { canEditDocument } from "@uniwork/core/permissions";
import { isMyFolder } from "@uniwork/core/types/document";
import { useMembers } from "@uniwork/core/workspaces";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { CollectionPageState } from "../layout/collection-page";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { AppLink, useNavigation } from "../navigation";
import { OfficeHomeLaunch, type OfficeHomeLaunchProps } from "../office/office-home-launch";
import { AccessReportMenu } from "./access-report/access-report-menu";
import { DocumentsGateState, useDocumentsGate } from "./documents-gate";
import { useCreateOfType } from "./documents-create";
import { CreateMenu } from "./documents-home-create";
import { DocumentsCollectionHeader, DocumentsHomeHeader, DocumentsHomeNote } from "./documents-home-header";
import { DocumentsLibraryList } from "./documents-library-list";
import type { LibraryDesktopOpen, LibraryRowHandlers } from "./documents-library-row";
import { LibraryToolbar } from "./documents-library-toolbar";
import { DocumentsSections, nonFolderRows, subfoldersOf } from "./documents-folders-grid";
import { DocumentsTrashView } from "./documents-trash-view";
import { DocumentsSidebar, DocumentsSidebarSheet, SOURCE_KINDS, type LibraryView } from "./documents-sidebar";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { groupRows, type GroupBy, type TypeChip } from "./library-rows";
import { sourceParentPath } from "./source-links";
import { useDocumentsLibrary } from "./use-documents-library";
import { useDocumentFileUpload } from "./use-document-file-upload";
import { useDropUpload } from "./use-drop-upload";
import { useSourcePreview } from "./source-preview-dialog";
import type { OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { useSourceOfficeViewer } from "./source-office-viewer";
import { useLibraryRowDialogs } from "./use-library-row-dialogs";
import { shouldRetryFolderDetail } from "./use-tree-reveal";
import { DocumentsSearchResults } from "./documents-search-results";
import { useDocumentsSearch } from "./use-documents-search";
import { useTrashActions } from "./use-trash-actions";

function viewFromSearchParams(searchParams: URLSearchParams): LibraryView {
  if (searchParams.get("folder")) return { kind: "home" };
  const rawView = searchParams.get("view");
  if (rawView === "recent" || rawView === "starred" || rawView === "shared" || rawView === "archived") return { kind: rawView };
  if (rawView === "shared-by-me") return { kind: "sharedByMe" };
  if (rawView === "sources") {
    const rawSource = searchParams.get("source");
    const source = rawSource && (SOURCE_KINDS as readonly string[]).includes(rawSource) ? (rawSource as (typeof SOURCE_KINDS)[number]) : null;
    return { kind: "sources", source };
  }
  return { kind: "home" };
}

function buildDocumentsViewUrl(
  wsPaths: { documents: () => string; documentsFolder: (folderId: string) => string },
  next: LibraryView,
  nextFolder: string | null,
): string {
  const targetFolder = next.kind === "home" ? nextFolder : null;
  if (targetFolder) return wsPaths.documentsFolder(targetFolder);
  const base = wsPaths.documents();
  if (next.kind === "home") return base;
  if (next.kind === "sources") return next.source ? `${base}?view=sources&source=${encodeURIComponent(next.source)}` : `${base}?view=sources`;
  return `${base}?view=${next.kind === "sharedByMe" ? "shared-by-me" : next.kind}`;
}

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
}

/**
 * `/documents` — the Documents home (TRASH-A3 boards, 2026-10-16): at home and
 * in a folder a header row, folder cards and the documents table; the Trash
 * view has its own table; Recent / Starred / Shared / Elsewhere keep the
 * collection header and the library table. Every row is a server answer;
 * create, upload and save await the server.
 */
export function DocumentsPageView({ wsId, onOpen, desktopOpen, officeHome, officeFrameVersion }: DocumentsPageViewProps) {
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
  const [chip, setChip] = useState<TypeChip>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("folder");
  const [navOpen, setNavOpen] = useState(false);

  const urlFolderId = searchParams.get("folder") || null;
  const folderId = view.kind === "home" ? urlFolderId : null;
  const wsPaths = useMemo(
    () => paths.workspace(context?.workspace.organization_slug || "org", context?.workspace.slug || wsId),
    [context?.workspace.organization_slug, context?.workspace.slug, wsId],
  );

  // Only the home root and the list views show a type control.
  const library = useDocumentsLibrary({ wsId, orgId, enabled, view, folderId, chip: view.kind === "archived" || folderId ? "all" : chip });
  const search = useDocumentsSearch(wsId, enabled);
  const folder = useDocument(wsId, folderId ?? "", {
    enabled: enabled && !!folderId,
    retry: shouldRetryFolderDetail,
  });
  const ensureMyFolder = useEnsureMyFolder(wsId);
  const creator = useCreateOfType(wsId, onOpen);
  const downloadSource = useDownloadDocumentSource(wsId);
  const sourcePreview = useSourcePreview(downloadSource);
  // The row-menu download (and the viewer's fallback when no module frame can
  // host the file): one code path for both, named for the file.
  const downloadSourceFile = (sourceId: string) => {
    void downloadSource.mutateAsync({ sourceId }).then(
      (blob) => {
        const name = library.state.rows.find((row) => row.type === "source" && row.source.id === sourceId);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name?.type === "source" ? name.source.name : "";
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      (error: unknown) => toast.error(apiErrorMessage(error) ?? t("documents.home.row.download_failed")),
    );
  };

  const officeViewer = useSourceOfficeViewer({
    wsId,
    organizationId: context?.workspace.organization_id,
    frameVersion: officeFrameVersion ?? (() => ""),
    onDownload: (source) => downloadSourceFile(source.id),
  });
  const favorite = useFavoriteDocument();
  const unfavorite = useUnfavoriteDocument();
  const members = useMembers(enabled ? wsId : "");

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
  const canCreate =
    !folderId ||
    (folderDoc !== null &&
      canEditDocument(folderDoc, { userId: context?.user.id ?? userId, orgRole: null, wsRole: null }).allowed);
  const parentForCreate = view.kind === "home" ? folderId : null;
  const fileUpload = useDocumentFileUpload({
    wsId,
    parentId: parentForCreate,
    limits,
    onOpen,
    description: t(parentForCreate && !isMyFolder(folderDoc) ? "documents.upload.description_folder" : "documents.upload.description"),
    rootDestination: "my_folder",
  });

  const rowDialogs = useLibraryRowDialogs({ wsId, tree: library.tree, folderId, folderTitle: openFolderTitle });
  const trashActions = useTrashActions({ wsId, rows: library.state.rows });
  // Move and archive sit on the rows of this workspace's own lists for
  // people who may change the open folder; the server decides per document.
  const rowCommands = canCreate && (view.kind === "home" || view.kind === "recent" || view.kind === "starred" || view.kind === "sharedByMe");

  const memberIndex = useMemo(() => new Map((members.data ?? []).map((m) => [m.user_id, m])), [members.data]);
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.user_id, m.display_name])), [members.data]);
  const drop = useDropUpload({
    enabled: enabled && canCreate && !folderInvalid,
    maxBytes: limits.upload_max_bytes,
    upload: fileUpload.uploadDroppedFile,
  });

  const goHome = (next: LibraryView, nextFolder: string | null = null) => {
    if (next.kind !== view.kind) {
      // Each view has its own filter controls; none carries over unseen.
      setChip("all");
      library.setAccess("all");
    }
    setView(next);
    setNavOpen(false);
    const targetFolder = next.kind === "home" ? nextFolder : null;
    const currentView = viewFromSearchParams(searchParams);
    const sameDestination =
      targetFolder === urlFolderId &&
      currentView.kind === next.kind &&
      (currentView.kind !== "sources" || next.kind !== "sources" || currentView.source === next.source);
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
    onOpen,
    onFolder: (id) => goHome({ kind: "home" }, id),
    onGoToSource: (row) => {
      const target = context ? sourceParentPath(paths.workspace(context.workspace.organization_slug, context.workspace.slug), row.source.parent) : null;
      if (target) push(target);
    },
    onPreviewSource: sourcePreview.open,
    // UNI-1869: an Office source opens view-only in its module frame; no module
    // or no installed build takes the download the click always offered.
    onViewSource: (source) => { if (!officeViewer.open(source)) downloadSourceFile(source.id); },
    onDownloadSource: downloadSourceFile,
    onSaveSource: rowDialogs.onSaveSource,
    onNewSubfolder: rowCommands ? rowDialogs.onNewSubfolder : undefined,
    onRename: rowCommands ? rowDialogs.onRename : undefined,
    onMove: rowCommands ? rowDialogs.onMove : undefined,
    onArchive: rowCommands ? rowDialogs.onArchive : undefined,
    onToggleStar: orgId
      ? (documentId, starred) => {
          const op = starred ? unfavorite : favorite;
          void op.mutateAsync(documentId).catch((error: unknown) => toast.error(apiErrorMessage(error) ?? t("documents.home.row.star_failed")));
        }
      : undefined,
    isStarred: (documentId) => library.starredIds.has(documentId),
    personName: (userId, kind) => names.get(userId) ?? (kind === "agent" ? t("documents.home.editor_agent") : null),
    desktopOpen,
  };

  const homeView = view.kind === "home";
  const homeFilters = homeView && !folderId && (library.editor !== "any" || library.updated !== "any");
  const accessFiltered = library.access !== "all";
  const filteredBy = chip !== "all" || accessFiltered ? (library.clientFiltered ? ("client" as const) : ("server" as const)) : null;
  const state = library.state;
  // At home and in a folder the folders are cards above the table.
  const tableRows = homeView ? nonFolderRows(state.rows) : state.rows;
  const groups = groupRows(tableRows, homeView ? "none" : groupBy, library.folderIndex, myFolderLabel);
  const subfolders = subfoldersOf(library.tree, folderId);
  // "filtered" still answers "is a filter on" (editor/updated live on the
  // home filter bar, chip/access everywhere the list toolbar shows): it gates
  // the folder's subfolders-only suppression (TV-4).
  const filtered = homeFilters || chip !== "all" || accessFiltered;
  const listLoading = state.loading || (Boolean(folderId) && folder.isPending);
  const emptyCopy = homeView
    ? {
        title: folderId ? t("documents.home.empty.folder_title") : t("documents.home.empty.title"),
        description: canCreate ? t("documents.home.empty.description") : t("documents.home.empty.view_only"),
        actions:
          folderId && canCreate ? (
            <Button type="button" variant="outline" size="sm" onClick={rowDialogs.onCreateFolder}>
              <FolderPlus aria-hidden className="size-3.5" />
              {t("documents.home.folders.create_title")}
            </Button>
          ) : undefined,
      }
    : { title: t(`documents.home.empty.${view.kind === "sharedByMe" ? "shared_by_me" : view.kind}_title`), description: t(`documents.home.empty.${view.kind === "sharedByMe" ? "shared_by_me" : view.kind}_description`) };

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
    onView: (next: LibraryView) => goHome(next),
    onFolder: (id: string) => goHome({ kind: "home" }, id),
    onMyFolder: openMyFolder,
    onNewFolder: (title?: string) => newRootFolder(title),
  };
  const createProps = {
    pending: creator.pending,
    unavailable: creator.unavailable,
    onCreate: (type: Parameters<typeof creator.create>[0]) => void creator.create(type, parentForCreate),
    onUpload: fileUpload.openUpload,
    onNewFolder: parentForCreate ? rowDialogs.onCreateFolder : undefined,
  };

  const navButton = (
    <Button type="button" variant="outline" size="sm" className="shrink-0 xl:hidden" onClick={() => setNavOpen(true)}>
      <FolderTree aria-hidden className="size-3.5" />
      {t("documents.home.sidebar.open")}
    </Button>
  );
  const hostActions = (
    <>
      {officeHome ? <OfficeHomeLaunch {...officeHome} /> : null}
      <AccessReportMenu onOpen={() => push(wsPaths.documentsAccessReport())} />
    </>
  );
  // Home, folder and Trash carry their own h1 (the boards); the other views
  // and the gate states keep the collection header.
  const collectionHeader = gate !== "on" || !(homeView || view.kind === "archived");
  const libraryList = (
    <DocumentsLibraryList
      groups={groups}
      loading={listLoading}
      failure={state.failure}
      filteredBy={filteredBy}
      accessFiltered={accessFiltered}
      typeFiltered={chip !== "all"}
      cardsShown={canCreate && homeView}
      hasMore={state.hasMore}
      loadingMore={state.loadingMore}
      onLoadMore={state.loadMore}
      onRetry={state.refetch}
      onClearFilters={() => {
        setChip("all");
        library.setAccess("all");
        library.setEditor("any");
        library.setUpdated("any");
      }}
      handlers={handlers}
      empty={emptyCopy}
    />
  );
  const toolbar = {
    chip,
    onChip: setChip,
    access: library.access,
    onAccess: library.setAccess,
    groupBy,
    onGroupBy: setGroupBy,
    sort: library.sort,
    onSort: library.setSort,
    editor: library.editor,
    onEditor: library.setEditor,
    members: members.data,
    updated: library.updated,
    onUpdated: library.setUpdated,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {collectionHeader ? (
        <DocumentsCollectionHeader search={enabled ? search : null}>
          {hostActions}
          {canCreate ? <CreateMenu {...createProps} /> : null}
        </DocumentsCollectionHeader>
      ) : null}

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
            {...drop.zoneProps}
          >
            {homeView ? (
              <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
                <DocumentsHomeHeader
                  wsId={wsId}
                  folderDoc={folderDoc}
                  canRename={canCreate}
                  myFolderId={myFolderId}
                  onRoot={() => goHome({ kind: "home" })}
                  onFolder={(id) => goHome({ kind: "home" }, id)}
                  folderHandlers={handlers}
                  search={search}
                  canCreate={canCreate && !folderInvalid}
                  create={createProps}
                  actions={
                    <>
                      {hostActions}
                      {navButton}
                    </>
                  }
                />
              </div>
            ) : null}
            {search.active ? (
              <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
                <DocumentsSearchResults
                  search={search}
                  myFolderId={myFolderId}
                  onSelectFolder={(id) => {
                    search.clear();
                    goHome({ kind: "home" }, id);
                  }}
                  onSelectDocument={onOpen}
                />
              </div>
            ) : folderInvalid ? (
              <CollectionPageState
                icon={CircleAlert}
                tone="destructive"
                role="alert"
                title={t("documents.home.folder_invalid.title")}
                description={t("documents.home.folder_invalid.description")}
                actions={
                  <AppLink
                    href={wsPaths.documents()}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    onClick={() => setView({ kind: "home" })}
                  >
                    {t("documents.home.folder_invalid.back")}
                  </AppLink>
                }
              />
            ) : view.kind === "archived" ? (
              <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 sm:px-6">
                <div className="flex justify-end xl:hidden">{navButton}</div>
                <DocumentsTrashView
                  rows={state.rows.flatMap((row) => (row.type === "document" ? [row.doc] : []))}
                  loading={state.loading}
                  failure={state.failure}
                  onRetry={state.refetch}
                  actions={trashActions}
                  members={memberIndex}
                  membersReady={Boolean(members.data)}
                  onOpen={(doc) => onOpen(doc.id)}
                  tree={library.tree}
                />
              </div>
            ) : homeView ? (
              <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
                {canCreate ? <DocumentsHomeNote folderTitle={openFolderTitle ?? null} create={folderId ? null : createProps} /> : null}
                <LibraryToolbar variant={folderId ? "folder" : "home"} {...toolbar} />
                <DocumentsSections
                  folderTitle={folderId ? "documents.home.sections.subfolders" : "documents.home.sections.folders"}
                  folders={subfolders}
                  documentsCount={tableRows.length}
                  hideDocuments={
                    // TV-4: a folder whose children are only subfolders is not
                    // empty, so it shows no "Tài liệu 0" and no empty copy.
                    // Filters, loading and failure keep their own states.
                    Boolean(folderId) && subfolders.length > 0 && tableRows.length === 0 && !filtered && !listLoading && !state.failure
                  }
                  grid={{ docById: library.docById, handlers, onOpenFolder: (id) => goHome({ kind: "home" }, id) }}
                >
                  {libraryList}
                </DocumentsSections>
                {canCreate && !listLoading && tableRows.length > 0 ? (
                  <p className="text-caption text-muted-foreground">{t("documents.home.drop_hint")}</p>
                ) : null}
              </div>
            ) : (
              <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-title font-semibold">{t(`documents.home.views.${view.kind === "sources" ? (view.source ?? "sources") : view.kind === "sharedByMe" ? "shared_by_me" : view.kind}`)}</h2>
                  {navButton}
                </div>
                <LibraryToolbar variant="list" {...toolbar} />
                {libraryList}
              </div>
            )}
            {drop.active ? (
              <div aria-hidden className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80 text-body font-medium text-foreground">
                {t("documents.home.drop_active")}
              </div>
            ) : null}
          </section>
        </div>
      )}

      <DocumentsSidebarSheet open={navOpen} onOpenChange={setNavOpen} {...sidebar} />

      <DocumentUploadDialog {...fileUpload.dialogProps} />

      {sourcePreview.dialog}
      {officeViewer.dialog}

      {trashActions.dialog}

      {rowDialogs.dialogs}
    </div>
  );
}
