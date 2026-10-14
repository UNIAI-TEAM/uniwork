"use client";

import { useMemo, useState } from "react";
import { CircleAlert, FolderTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useAuthStore } from "@uniwork/core/auth";
import { useCreateDocumentFile, useDocument, useUpdateDocument } from "@uniwork/core/documents/hooks";
import { useFavoriteDocument, useUnfavoriteDocument } from "@uniwork/core/documents/hooks-favorites";
import { useDownloadDocumentSource } from "@uniwork/core/documents/hooks-library";
import { paths } from "@uniwork/core/paths";
import { canEditDocument } from "@uniwork/core/permissions";
import { useMembers } from "@uniwork/core/workspaces";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { AppLink, useNavigation } from "../navigation";
import { OfficeHomeLaunch, type OfficeHomeLaunchProps } from "../office/office-home-launch";
import { DocumentsGateState, useDocumentsGate } from "./documents-gate";
import { useCreateOfType } from "./documents-create";
import { CreateCards, CreateMenu, DocumentsGreeting } from "./documents-home-create";
import { DocumentsLibraryList } from "./documents-library-list";
import type { LibraryDesktopOpen, LibraryRowHandlers } from "./documents-library-row";
import { FolderBreadcrumb, LibraryToolbar, type ScopeTab } from "./documents-library-toolbar";
import { DocumentsSidebar, DocumentsSidebarSheet, SOURCE_KINDS, type LibraryView } from "./documents-sidebar";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { groupRows, type GroupBy, type TypeChip } from "./library-rows";
import { sourceParentPath } from "./source-links";
import { useDocumentsLibrary } from "./use-documents-library";
import { documentErrorMessage } from "./document-error-message";
import { useDropUpload } from "./use-drop-upload";
import { useLibraryRowDialogs } from "./use-library-row-dialogs";
import { shouldRetryFolderDetail } from "./use-tree-reveal";
import { DocumentsSearchBox } from "./documents-search-box";
import { DocumentsSearchResults } from "./documents-search-results";
import { useDocumentsSearch } from "./use-documents-search";

function viewFromSearchParams(searchParams: URLSearchParams): LibraryView {
  if (searchParams.get("folder")) return { kind: "home" };
  const rawView = searchParams.get("view");
  switch (rawView) {
    case "recent":
    case "starred":
    case "shared":
    case "archived":
      return { kind: rawView };
    case "sources": {
      const rawSource = searchParams.get("source");
      const source =
        rawSource && (SOURCE_KINDS as readonly string[]).includes(rawSource)
          ? (rawSource as (typeof SOURCE_KINDS)[number])
          : null;
      return { kind: "sources", source };
    }
    default:
      return { kind: "home" };
  }
}

function buildDocumentsViewUrl(
  wsPaths: ReturnType<typeof paths.workspace>,
  next: LibraryView,
  nextFolder: string | null,
): string {
  const targetFolder = next.kind === "home" ? nextFolder : null;
  if (targetFolder) return wsPaths.documentsFolder(targetFolder);
  const base = wsPaths.documents();
  if (next.kind === "home") return base;
  if (next.kind === "sources") {
    return next.source
      ? `${base}?view=sources&source=${encodeURIComponent(next.source)}`
      : `${base}?view=sources`;
  }
  return `${base}?view=${next.kind}`;
}

export interface DocumentsPageViewProps {
  wsId: string;
  /** Opens the document the user created, uploaded or picked from a list. */
  onOpen: (documentId: string) => void;
  /** Host wiring of "Open in UniWork Office" per file row; without it rows have no app action. */
  desktopOpen?: LibraryDesktopOpen;
  /** Host wiring of the header "Open UniWork Office" (the app, no document); absent hides it. */
  officeHome?: OfficeHomeLaunchProps;
}

/**
 * `/documents` — the Documents home (UNI-1305 design, 2026-10-12): greeting,
 * create cards and the "New" menu, the navigation (collections, folders, files
 * from other modules) and one library table with type chips and grouping.
 * Every row is a server answer; create, upload and save await the server.
 */
export function DocumentsPageView({ wsId, onOpen, desktopOpen, officeHome }: DocumentsPageViewProps) {
  const { t } = useTranslation();
  const { gate, retry: retryGate } = useDocumentsGate();
  const enabled = gate === "on";
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
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const urlFolderId = searchParams.get("folder") || null;
  const folderId = view.kind === "home" ? urlFolderId : null;
  const wsPaths = useMemo(
    () => paths.workspace(context?.workspace.organization_slug || "org", context?.workspace.slug || wsId),
    [context?.workspace.organization_slug, context?.workspace.slug, wsId],
  );

  const library = useDocumentsLibrary({ wsId, orgId, enabled, view, folderId, chip });
  const search = useDocumentsSearch(wsId, enabled);
  const folder = useDocument(wsId, folderId ?? "", {
    enabled: enabled && !!folderId,
    retry: shouldRetryFolderDetail,
  });
  const renameFolder = useUpdateDocument(wsId, folderId ?? "");
  const createFile = useCreateDocumentFile(wsId);
  const creator = useCreateOfType(wsId, onOpen);
  const downloadSource = useDownloadDocumentSource(wsId);
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
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const canCreate =
    !folderId ||
    (folderDoc !== null &&
      canEditDocument(folderDoc, { userId: context?.user.id ?? userId, orgRole: null, wsRole: null }).allowed);
  const parentForCreate = view.kind === "home" ? folderId : null;

  const rowDialogs = useLibraryRowDialogs({ wsId, tree: library.tree, folderId });
  // Move and archive sit on the rows of this workspace's own lists for
  // people who may change the open folder; the server decides per document.
  const rowCommands = canCreate && (view.kind === "home" || view.kind === "recent" || view.kind === "starred");

  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.user_id, m.display_name])), [members.data]);
  const drop = useDropUpload({
    enabled: enabled && canCreate && !folderInvalid,
    upload: async (file) => {
      await createFile.mutateAsync({ file, meta: parentForCreate ? { parent_id: parentForCreate } : undefined });
    },
  });

  const goHome = (next: LibraryView, nextFolder: string | null = null) => {
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

  const uploadFile = async (file: File) => {
    setUploadError(null);
    try {
      const doc = await createFile.mutateAsync({ file, meta: parentForCreate ? { parent_id: parentForCreate } : undefined });
      setUploadOpen(false);
      onOpen(doc.id);
    } catch (error) {
      setUploadError(documentErrorMessage(error, t, "documents.page.upload_failed"));
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

  const handlers: LibraryRowHandlers = {
    onOpen,
    onFolder: (id) => goHome({ kind: "home" }, id),
    onGoToSource: (row) => {
      const target = context ? sourceParentPath(paths.workspace(context.workspace.organization_slug, context.workspace.slug), row.source.parent) : null;
      if (target) push(target);
    },
    onDownloadSource: (sourceId) => {
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
    },
    onSaveSource: rowDialogs.onSaveSource,
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

  const groups = groupRows(library.state.rows, view.kind === "home" && folderId ? "none" : groupBy, library.folderIndex);
  const scope: ScopeTab | null = view.kind === "home" || view.kind === "recent" || view.kind === "shared" || view.kind === "archived" ? view.kind : null;
  const filtered = chip !== "all" && library.unfilteredCount > 0;
  const state = library.state;
  const listLoading = state.loading || (Boolean(folderId) && folder.isPending);
  // The header and the active tab count the same thing: the rows this list
  // shows (folders and linked files included), so the two numbers and the
  // group totals always add up.
  const listedCount = state.rows.length;
  const emptyCopy =
    view.kind === "home"
      ? {
          title: folderId ? t("documents.home.empty.folder_title") : t("documents.home.empty.title"),
          description: canCreate ? t("documents.home.empty.description") : t("documents.home.empty.view_only"),
        }
      : { title: t(`documents.home.empty.${view.kind}_title`), description: t(`documents.home.empty.${view.kind}_description`) };

  const breadcrumbPath = folderDoc
    ? [...folderDoc.breadcrumbs.filter((crumb) => crumb.id !== folderDoc.id).map(({ id, title }) => ({ id, title })), { id: folderDoc.id, title: folderDoc.title }]
    : [];
  const sidebar = {
    wsId,
    view,
    folderId,
    starredCount: library.starredCount,
    sourcesAvailable: library.sourcesAvailable,
    canCreate: !folderId || canCreate,
    newFolderPending: creator.folderPending,
    onView: (next: LibraryView) => goHome(next),
    onFolder: (id: string) => goHome({ kind: "home" }, id),
    onNewFolder: (title?: string) => newRootFolder(title),
  };
  const createProps = {
    pending: creator.pending,
    unavailable: creator.unavailable,
    onCreate: (type: Parameters<typeof creator.create>[0]) => void creator.create(type, parentForCreate),
    onUpload: () => setUploadOpen(true),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={MODULE_ICONS.documents}
        tone={moduleTone("documents")}
        title={t("documents.page.title")}
        count={enabled && view.kind === "home" && !folderId && !listLoading && !state.hasMore ? listedCount : undefined}
        className={enabled ? "h-auto min-h-12 flex-wrap py-2 sm:h-12 sm:flex-nowrap sm:py-0" : undefined}
        actions={
          enabled ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
              <DocumentsSearchBox search={search} className="order-last w-full sm:order-first sm:w-64" />
              {officeHome ? <OfficeHomeLaunch {...officeHome} /> : null}
              {canCreate ? <CreateMenu {...createProps} /> : null}
            </div>
          ) : null
        }
      />

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
            {search.active ? (
              <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
                <DocumentsSearchResults
                  search={search}
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
            ) : (
              <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
                <div className="flex items-start justify-between gap-3">
                  {view.kind === "home" ? (
                    <DocumentsGreeting name={context?.user.display_name ?? null} folderTitle={folderDoc?.title ?? null} readOnly={!canCreate} />
                  ) : (
                    <h2 className="text-title font-semibold">{t(`documents.home.views.${view.kind === "sources" ? (view.source ?? "sources") : view.kind}`)}</h2>
                  )}
                  <Button type="button" variant="outline" size="sm" className="shrink-0 xl:hidden" onClick={() => setNavOpen(true)}>
                    <FolderTree aria-hidden className="size-3.5" />
                    {t("documents.home.sidebar.open")}
                  </Button>
                </div>
                {view.kind === "home" && canCreate ? <CreateCards {...createProps} /> : null}
                {view.kind === "home" && folderId && folderDoc ? (
                  <FolderBreadcrumb
                    path={breadcrumbPath}
                    canRename={canCreate}
                    renaming={renameFolder.isPending}
                    onRoot={() => goHome({ kind: "home" })}
                    onFolder={(id) => goHome({ kind: "home" }, id)}
                    onRename={(title) => {
                      void renameFolder
                        .mutateAsync({ patch: { revision: folderDoc.revision, title } })
                        .catch((error: unknown) => toast.error(apiErrorMessage(error) ?? t("documents.home.folders.rename_failed")));
                    }}
                  />
                ) : null}
                <LibraryToolbar
                  scope={scope}
                  count={scope && !listLoading ? { value: state.rows.length, more: state.hasMore } : null}
                  onScope={(next) => goHome({ kind: next })}
                  chip={chip}
                  onChip={setChip}
                  groupBy={groupBy}
                  onGroupBy={setGroupBy}
                />
                <DocumentsLibraryList
                  groups={groups}
                  loading={listLoading}
                  failure={state.failure}
                  filtered={filtered}
                  cardsShown={canCreate && view.kind === "home"}
                  archived={view.kind === "archived"}
                  hasMore={state.hasMore}
                  loadingMore={state.loadingMore}
                  onLoadMore={state.loadMore}
                  onRetry={state.refetch}
                  onClearFilters={() => setChip("all")}
                  handlers={handlers}
                  empty={emptyCopy}
                />
                {canCreate && view.kind === "home" && !listLoading && state.rows.length > 0 ? (
                  <p className="text-caption text-muted-foreground">{t("documents.home.drop_hint")}</p>
                ) : null}
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

      <DocumentUploadDialog
        open={uploadOpen}
        onOpenChange={(next) => {
          if (!next) setUploadError(null);
          setUploadOpen(next);
        }}
        title={t("documents.upload.title")}
        description={t("documents.upload.description")}
        hint={t("documents.upload.size_hint")}
        pending={createFile.isPending}
        error={uploadError}
        onSubmit={(file) => void uploadFile(file)}
      />

      {rowDialogs.dialogs}
    </div>
  );
}
