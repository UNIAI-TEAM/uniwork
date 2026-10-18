"use client";

import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMoveDocument } from "@uniwork/core/documents/hooks-collections";
import { useSaveSourceToFolder } from "@uniwork/core/documents/hooks-library";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { isMyFolder, type DocumentTreeNode } from "@uniwork/core/types/document";
import { createSafeId } from "@uniwork/core/utils";
import { DocumentArchiveDialog } from "./document-archive-dialog";
import { documentErrorMessage } from "./document-error-message";
import { isParentWorkspaceShared, type CreateShareOptions } from "./documents-create";
import { findTreeNode, loadMoveRevision } from "./document-tree-model";
import { FolderNameDialog } from "./folder-name-dialog";
import { FolderPickerDialog } from "./folder-picker-dialog";
import type { DocumentSummaryRow } from "./library-rows";

type SourceRow = { type: "source"; id: string; source: DocumentSourceFile };

type NameDialogState =
  | { mode: "create"; parentId: string | null; parentTitle?: string; parentShared?: boolean; shareWithWorkspace?: boolean }
  | { mode: "rename"; doc: DocumentSummaryRow };

export interface LibraryRowDialogs {
  onSaveSource: (row: SourceRow) => void;
  /** `options.shareWithWorkspace` opens the dialog with its share toggle already on. */
  onCreateFolder: (options?: CreateShareOptions) => void;
  onNewSubfolder: (doc: DocumentSummaryRow) => void;
  onRename: (doc: DocumentSummaryRow) => void;
  onMove: (doc: DocumentSummaryRow) => void;
  onArchive: (doc: DocumentSummaryRow) => void;
  dialogs: ReactNode;
}

/**
 * The library row commands that need a dialog: save a file from another
 * module into a folder, create a folder / subfolder, rename a folder or
 * document, move a document to another folder, archive one. Restore and
 * purge belong to the trash table's own actions (use-trash-actions).
 * Each awaits the server; a refusal stays in the dialog (create, rename,
 * move, save) or the archive dialog's own message, and nothing on screen
 * moves before that.
 */
export function useLibraryRowDialogs({
  wsId,
  tree,
  folderId,
  folderTitle,
  parentShared,
}: {
  wsId: string;
  tree: DocumentTreeNode[];
  /** The folder the library has open, preselected in the pickers. */
  folderId: string | null;
  /** Title of the open folder for the "New -> Folder" dialog header. */
  folderTitle?: string;
  /** True when the open folder already shares with the home workspace. */
  parentShared?: boolean;
}): LibraryRowDialogs {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const saveSource = useSaveSourceToFolder(wsId);
  const move = useMoveDocument(wsId);
  const [saving, setSaving] = useState<SourceRow | null>(null);
  const [naming, setNaming] = useState<NameDialogState | null>(null);
  const [moving, setMoving] = useState<DocumentSummaryRow | null>(null);
  const [archiving, setArchiving] = useState<DocumentSummaryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  // One key per source and target: a retry after a timeout replays the same save, a new target is a new one.
  const saveKey = useRef<{ sourceId: string; target: string | null; key: string } | null>(null);

  const submitMove = async (doc: DocumentSummaryRow, parentId: string | null) => {
    setError(null);
    setMoveLoading(true);
    try {
      const revision = await loadMoveRevision(queryClient, wsId, doc.id);
      if (!revision) {
        setError(t("documents.tree.move_failed"));
        return;
      }
      const movedDoc = await move.mutateAsync({ documentId: doc.id, parent_id: parentId, revision });
      setMoving(null);
      if (movedDoc.title && movedDoc.title !== doc.title) {
        toast.success(t("documents.home.move.moved_renamed", { title: movedDoc.title }));
      } else {
        const targetNode = parentId === null ? undefined : findTreeNode(tree, parentId);
        const folder =
          parentId === null
            ? t("documents.home.move.root")
            : (isMyFolder(targetNode) ? t("documents.home.my_folder.label") : targetNode?.title) || t("documents.detail.untitled");
        toast.success(t("documents.home.move.moved_to", { folder }));
      }
    } catch (failure) {
      setError(documentErrorMessage(failure, t, "documents.tree.move_failed"));
    } finally {
      setMoveLoading(false);
    }
  };

  const dialogs = (
    <>
      <FolderNameDialog
        open={naming !== null}
        onOpenChange={(next) => {
          if (!next) setNaming(null);
        }}
        mode={naming?.mode ?? "create"}
        parentId={naming?.mode === "create" ? naming.parentId : null}
        parentTitle={naming?.mode === "create" ? naming.parentTitle : undefined}
        parentShared={naming?.mode === "create" ? naming.parentShared : undefined}
        initialShareWithWorkspace={naming?.mode === "create" ? Boolean(naming.shareWithWorkspace) : false}
        folderId={naming?.mode === "rename" ? naming.doc.id : ""}
        initialName={naming?.mode === "rename" ? naming.doc.title : ""}
        kind={naming?.mode === "rename" ? naming.doc.kind : "folder"}
        revision={naming?.mode === "rename" ? naming.doc.revision : undefined}
        wsId={wsId}
      />
      <FolderPickerDialog
        open={saving !== null}
        onOpenChange={(next) => {
          if (!next) setSaving(null);
        }}
        title={t("documents.home.save_source.title")}
        description={t("documents.home.save_source.description", { name: saving?.source.name ?? "" })}
        submitLabel={t("documents.home.save_source.submit")}
        pickerLabel={t("documents.home.save_source.picker_label")}
        rootLabel={t("documents.home.save_source.root")}
        tree={tree}
        initialFolderId={folderId}
        pending={saveSource.isPending}
        error={saving ? error : null}
        onSubmit={(target) => {
          if (!saving) return;
          setError(null);
          const sourceId = saving.source.id;
          if (saveKey.current?.sourceId !== sourceId || saveKey.current.target !== target) {
            saveKey.current = { sourceId, target, key: createSafeId() };
          }
          void saveSource.mutateAsync({ sourceId, parentId: target, idempotencyKey: saveKey.current.key }).then(
            () => {
              saveKey.current = null;
              setSaving(null);
              toast.success(t("documents.home.save_source.saved"));
            },
            (failure: unknown) => setError(documentErrorMessage(failure, t, "documents.home.save_source.failed")),
          );
        }}
      />
      <FolderPickerDialog
        open={moving !== null}
        onOpenChange={(next) => {
          if (!next) setMoving(null);
        }}
        title={t("documents.home.move.picker_title")}
        description={
          // Only a folder takes its contents along; a file or a page moves alone.
          t(moving?.kind === "folder" ? "documents.home.move.folder_description" : "documents.home.move.description", {
            name: moving?.title || t("documents.detail.untitled"),
          })
        }
        submitLabel={t("documents.home.move.submit")}
        pickerLabel={t("documents.home.move.picker_label")}
        rootLabel={t("documents.home.move.root")}
        tree={tree}
        initialFolderId={moving?.parent_id ?? null}
        currentFolderId={moving ? (moving.parent_id ?? null) : undefined}
        movingId={moving?.id ?? null}
        pending={moveLoading}
        error={moving ? error : null}
        onSubmit={(target) => {
          if (moving) void submitMove(moving, target);
        }}
      />
      {archiving ? (
        <DocumentArchiveDialog
          open
          onOpenChange={(next) => {
            if (!next) setArchiving(null);
          }}
          wsId={wsId}
          doc={archiving}
          mode="archive"
        />
      ) : null}
    </>
  );

  return {
    onSaveSource: (row) => {
      setError(null);
      setSaving(row);
    },
    onCreateFolder: (options) =>
      setNaming({
        mode: "create",
        parentId: folderId,
        parentTitle: folderTitle,
        parentShared,
        shareWithWorkspace: Boolean(options?.shareWithWorkspace),
      }),
    onNewSubfolder: (doc) =>
      setNaming({
        mode: "create",
        parentId: doc.id,
        parentTitle: isMyFolder(doc) ? t("documents.home.my_folder.label") : doc.title,
        parentShared: isParentWorkspaceShared(doc, findTreeNode(tree, doc.id)),
      }),
    onRename: (doc) => {
      if (isMyFolder(doc)) return;
      setNaming({ mode: "rename", doc });
    },
    onMove: (doc) => {
      if (isMyFolder(doc)) return;
      setError(null);
      setMoving(doc);
    },
    onArchive: (doc) => {
      if (isMyFolder(doc)) return;
      setArchiving(doc);
    },
    dialogs,
  };
}
