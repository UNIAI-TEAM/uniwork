"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFolderAccessBatchStore } from "@uniwork/core/documents/folder-access-batches";
import { isMyFolder } from "@uniwork/core/types/document";
import { FolderContentsAccessDialog, type TrackedFolderBatch } from "./folder-contents-access-dialog";
import type { DocumentSummaryRow } from "./library-rows";

export interface FolderContentsAccessCommand {
  /** Opens "Chia sẻ" on a folder row. */
  onShareContents: (folder: DocumentSummaryRow) => void;
  /** The dialog; mount it once beside the host's other dialogs. */
  dialogs: ReactNode;
}

/**
 * Owns the folder contents access dialog for one host (a list page or the
 * sidebar tree). A background batch outlives the dialog and the host: it is
 * handed to the core batch store, and the watcher list the workspace shell
 * mounts (`FolderAccessBatchWatchers`) keeps the poll alive and toasts when
 * the batch ends.
 */
export function useFolderContentsAccess(wsId: string): FolderContentsAccessCommand {
  const { t } = useTranslation();
  const [folder, setFolder] = useState<DocumentSummaryRow | null>(null);
  // The batch the open dialog is showing: its failure reads inline there, so the shell watcher keeps the toast back.
  const [shownBatchId, setShownBatchId] = useState<string | null>(null);
  const trackBatch = useFolderAccessBatchStore((state) => state.track);
  const showBatch = useFolderAccessBatchStore((state) => state.show);
  const hideBatch = useFolderAccessBatchStore((state) => state.hide);

  const inDialogBatchId = folder !== null ? shownBatchId : null;
  useEffect(() => {
    if (inDialogBatchId === null) return;
    showBatch(wsId, inDialogBatchId);
    // Closing the dialog, or leaving the page with it open, hands the failure toast back to the watcher.
    return () => hideBatch(wsId, inDialogBatchId);
  }, [wsId, inDialogBatchId, showBatch, hideBatch]);

  const track = useCallback(
    (batch: TrackedFolderBatch) => {
      trackBatch({ wsId, ...batch });
      setShownBatchId(batch.batchId);
    },
    [wsId, trackBatch],
  );

  return {
    onShareContents: (row) => {
      if (row.kind === "folder") setFolder(row);
    },
    dialogs: (
      <>
        {folder ? (
          <FolderContentsAccessDialog
            wsId={wsId}
            folder={{ id: folder.id, title: isMyFolder(folder) ? t("documents.home.my_folder.label") : folder.title, workspace_id: folder.workspace_id }}
            onOpenChange={(next) => {
              if (next) return;
              setFolder(null);
              setShownBatchId(null);
            }}
            onTrackBatch={track}
          />
        ) : null}
      </>
    ),
  };
}
