"use client";

import { useMemo, useState } from "react";
import { FolderTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useAuthStore } from "@uniwork/core/auth";
import { useCreateDocumentFile, useDocument, useUpdateDocument } from "@uniwork/core/documents/hooks";
import { useFavoriteDocument, useUnfavoriteDocument } from "@uniwork/core/documents/hooks-favorites";
import { useDownloadDocumentSource, useSaveSourceToFolder } from "@uniwork/core/documents/hooks-library";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { paths } from "@uniwork/core/paths";
import { canEditDocument } from "@uniwork/core/permissions";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { CollectionPageHeader } from "../layout/collection-page";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import { DocumentsGateState, useDocumentsGate } from "./documents-gate";
import { useCreateOfType } from "./documents-create";
import { CreateCards, CreateMenu, DocumentsGreeting } from "./documents-home-create";
import { DocumentsLibraryList } from "./documents-library-list";
import type { LibraryDesktopOpen, LibraryRowHandlers } from "./documents-library-row";
import { FolderBreadcrumb, LibraryToolbar, type ScopeTab } from "./documents-library-toolbar";
import { DocumentsSidebar, DocumentsSidebarSheet, type LibraryView } from "./documents-sidebar";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { groupRows, type GroupBy, type TypeChip } from "./library-rows";
import { SaveSourceDialog } from "./save-source-dialog";
import { sourceParentPath } from "./source-links";
import { useDocumentsLibrary } from "./use-documents-library";
import { useDropUpload } from "./use-drop-upload";

export interface DocumentsPageViewProps {
  wsId: string;
  /** Opens the document the user created, uploaded or picked from a list. */
  onOpen: (documentId: string) => void;
  /** Host wiring of "Open in UniWork Office" per file row; without it rows have no app action. */
  desktopOpen?: LibraryDesktopOpen;
}

type SourceRow = { type: "source"; id: string; source: DocumentSourceFile };

/**
 * `/documents` — the Documents home (UNI-1305 design, 2026-10-12): greeting,
 * create cards and the "New" menu, the navigation (collections, folders, files
 * from other modules) and one library table with type chips and grouping.
 * Every row is a server answer; create, upload and save await the server.
 */
export function DocumentsPageView({ wsId, onOpen, desktopOpen }: DocumentsPageViewProps) {
  const { t } = useTranslation();
  const { gate, retry: retryGate } = useDocumentsGate();
  const enabled = gate === "on";
  const context = useOptionalWorkspace();
  const orgId = context?.workspace.organization_id ?? "";
  const { push } = useNavigation();

  const [view, setView] = useState<LibraryView>({ kind: "home" });
  const [folderId, setFolderId] = useState<string | null>(null);
  const [chip, setChip] = useState<TypeChip>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("folder");
  const [navOpen, setNavOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<SourceRow | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const library = useDocumentsLibrary({ wsId, orgId, enabled, view, folderId, chip });
  const folder = useDocument(wsId, folderId ?? "", { enabled: enabled && !!folderId });
  const renameFolder = useUpdateDocument(wsId, folderId ?? "");
  const createFile = useCreateDocumentFile(wsId);
  const creator = useCreateOfType(wsId, onOpen);
  const saveSource = useSaveSourceToFolder(wsId);
  const downloadSource = useDownloadDocumentSource(wsId);
  const favorite = useFavoriteDocument();
  const unfavorite = useUnfavoriteDocument();
  const members = useMembers(enabled ? wsId : "");

  // At the workspace root every member may create (DocumentService.CreatePage
  // asks RequireMember only); inside a folder the folder's own level decides,
  // and a viewer of it sees no create control at all.
  const folderDoc = folder.data ?? null;
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const canCreate =
    !folderId ||
    (folderDoc !== null &&
      canEditDocument(folderDoc, { userId: context?.user.id ?? userId, orgRole: null, wsRole: null }).allowed);
  const parentForCreate = view.kind === "home" ? folderId : null;

  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.user_id, m.display_name])), [members.data]);
  const drop = useDropUpload({
    enabled: enabled && canCreate,
    upload: async (file) => {
      await createFile.mutateAsync({ file, meta: parentForCreate ? { parent_id: parentForCreate } : undefined });
    },
  });

  const goHome = (next: LibraryView, nextFolder: string | null = null) => {
    setView(next);
    setFolderId(nextFolder);
    setNavOpen(false);
  };

  const uploadFile = async (file: File) => {
    setUploadError(null);
    try {
      const doc = await createFile.mutateAsync({ file, meta: parentForCreate ? { parent_id: parentForCreate } : undefined });
      setUploadOpen(false);
      onOpen(doc.id);
    } catch (error) {
      setUploadError(apiErrorMessage(error) ?? t("documents.page.upload_failed"));
    }
  };

  const newFolder = async () => {
    const id = await creator.newFolder(parentForCreate);
    if (id) goHome({ kind: "home" }, id);
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
    onSaveSource: (row) => {
      setSaveError(null);
      setSaving(row);
    },
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
    onView: (next: LibraryView) => goHome(next),
    onFolder: (id: string) => goHome({ kind: "home" }, id),
    onNewFolder: () => void newFolder(),
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
        count={enabled && view.kind === "home" && !folderId && !state.loading && !state.hasMore ? state.rows.length : undefined}
        actions={enabled && canCreate ? <CreateMenu {...createProps} /> : null}
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
            <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                {view.kind === "home" ? (
                  <DocumentsGreeting name={context?.user.display_name ?? null} folderTitle={folderDoc?.title ?? null} />
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
                count={scope && !state.loading ? { value: state.rows.length, more: state.hasMore } : null}
                onScope={(next) => goHome({ kind: next })}
                chip={chip}
                onChip={setChip}
                groupBy={groupBy}
                onGroupBy={setGroupBy}
              />
              <DocumentsLibraryList
                groups={groups}
                loading={state.loading}
                failure={state.failure}
                filtered={filtered}
                archived={view.kind === "archived"}
                hasMore={state.hasMore}
                loadingMore={state.loadingMore}
                onLoadMore={state.loadMore}
                onRetry={state.refetch}
                onClearFilters={() => setChip("all")}
                handlers={handlers}
                empty={emptyCopy}
              />
              {canCreate && view.kind === "home" ? (
                <p className="text-caption text-muted-foreground">{t("documents.home.drop_hint")}</p>
              ) : null}
            </div>
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

      <SaveSourceDialog
        open={saving !== null}
        onOpenChange={(next) => {
          if (!next) setSaving(null);
        }}
        name={saving?.source.name ?? ""}
        tree={library.tree}
        initialFolderId={folderId}
        pending={saveSource.isPending}
        error={saveError}
        onSubmit={(target) => {
          if (!saving) return;
          setSaveError(null);
          void saveSource.mutateAsync({ sourceId: saving.source.id, parentId: target }).then(
            () => {
              setSaving(null);
              toast.success(t("documents.home.save_source.saved"));
            },
            (error: unknown) => setSaveError(apiErrorMessage(error) ?? t("documents.home.save_source.failed")),
          );
        }}
      />
    </div>
  );
}
