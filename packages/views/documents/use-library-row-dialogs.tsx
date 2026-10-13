"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMoveDocument } from "@uniwork/core/documents/hooks-collections";
import { useSaveSourceToFolder } from "@uniwork/core/documents/hooks-library";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { createSafeId } from "@uniwork/core/utils";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { DocumentArchiveDialog } from "./document-archive-dialog";
import { documentErrorMessage } from "./document-error-message";
import { loadMoveRevision, moveRefused, moveTooDeep } from "./document-tree-model";
import { FolderPickerDialog } from "./folder-picker-dialog";
import type { DocumentSummaryRow } from "./library-rows";

type SourceRow = { type: "source"; id: string; source: DocumentSourceFile };

export interface LibraryRowDialogs {
  onSaveSource: (row: SourceRow) => void;
  onMove: (doc: DocumentSummaryRow) => void;
  onArchive: (doc: DocumentSummaryRow) => void;
  dialogs: ReactNode;
}

/**
 * The library row commands that need a dialog: save a file from another
 * module into a folder, move a document to another folder, archive one.
 * Each awaits the server; a refusal stays in the dialog (move, save) or the
 * archive dialog's own message, and nothing on screen moves before that.
 */
export function useLibraryRowDialogs({
  wsId,
  tree,
  folderId,
}: {
  wsId: string;
  tree: DocumentTreeNode[];
  /** The folder the library has open, preselected in the pickers. */
  folderId: string | null;
}): LibraryRowDialogs {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const saveSource = useSaveSourceToFolder(wsId);
  const move = useMoveDocument(wsId);
  const [saving, setSaving] = useState<SourceRow | null>(null);
  const [moving, setMoving] = useState<DocumentSummaryRow | null>(null);
  const [archiving, setArchiving] = useState<DocumentSummaryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  // One key per source and target: a retry after a timeout replays the same save, a new target is a new one.
  const saveKey = useRef<{ sourceId: string; target: string | null; key: string } | null>(null);

  // Targets the server would refuse are not offered: the moved item, its
  // subtree, and a folder where it would end up past the depth limit.
  const movingId = moving?.id ?? null;
  const refuseTarget = useCallback(
    (folderId: string) => (movingId ? moveRefused(tree, movingId, folderId) || moveTooDeep(tree, movingId, folderId) : false),
    [tree, movingId],
  );

  const submitMove = async (doc: DocumentSummaryRow, parentId: string | null) => {
    setError(null);
    setMoveLoading(true);
    try {
      const revision = await loadMoveRevision(queryClient, wsId, doc.id);
      if (!revision) {
        setError(t("documents.tree.move_failed"));
        return;
      }
      await move.mutateAsync({ documentId: doc.id, parent_id: parentId, revision });
      setMoving(null);
      toast.success(t("documents.home.move.moved"));
    } catch (failure) {
      setError(documentErrorMessage(failure, t, "documents.tree.move_failed"));
    } finally {
      setMoveLoading(false);
    }
  };

  const dialogs = (
    <>
      <FolderPickerDialog
        open={saving !== null}
        onOpenChange={(next) => {
          if (!next) setSaving(null);
        }}
        title={t("documents.home.save_source.title")}
        description={t("documents.home.save_source.description", { name: saving?.source.name ?? "" })}
        submitLabel={t("documents.home.save_source.submit")}
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
        title={t("documents.home.move.title")}
        description={
          // Only a folder takes its contents along; a file or a page moves alone.
          t(moving?.kind === "folder" ? "documents.home.move.folder_description" : "documents.home.move.description", {
            name: moving?.title || t("documents.detail.untitled"),
          })
        }
        submitLabel={t("documents.home.move.submit")}
        tree={tree}
        initialFolderId={moving?.parent_id ?? null}
        refuse={refuseTarget}
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
    onMove: (doc) => {
      setError(null);
      setMoving(doc);
    },
    onArchive: (doc) => setArchiving(doc),
    dialogs,
  };
}
