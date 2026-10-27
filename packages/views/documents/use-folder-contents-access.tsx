"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isMyFolder } from "@uniwork/core/types/document";
import { FolderContentsAccessDialog, type TrackedFolderBatch } from "./folder-contents-access-dialog";
import { FolderContentsAccessWatcher } from "./folder-contents-access-progress";
import type { DocumentSummaryRow } from "./library-rows";

export interface FolderContentsAccessCommand {
  /** Opens "Chia sẻ các tài liệu bên trong…" on a folder row. */
  onShareContents: (folder: DocumentSummaryRow) => void;
  /** The dialog plus one watcher per background batch; mount it once beside the host's other dialogs. */
  dialogs: ReactNode;
}

/**
 * Owns the folder contents access dialog for one host (a list page or the
 * sidebar tree). A background batch outlives the dialog: its watcher stays
 * mounted here, keeps the poll alive and toasts when the batch ends.
 */
export function useFolderContentsAccess(wsId: string): FolderContentsAccessCommand {
  const { t } = useTranslation();
  const [folder, setFolder] = useState<DocumentSummaryRow | null>(null);
  const [tracked, setTracked] = useState<TrackedFolderBatch[]>([]);

  const track = useCallback((batch: TrackedFolderBatch) => {
    setTracked((prev) => (prev.some((b) => b.batchId === batch.batchId) ? prev : [...prev, batch]));
  }, []);
  const settle = useCallback((batchId: string) => {
    setTracked((prev) => prev.filter((b) => b.batchId !== batchId));
  }, []);

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
              if (!next) setFolder(null);
            }}
            onTrackBatch={track}
          />
        ) : null}
        {tracked.map((batch) => (
          <FolderContentsAccessWatcher key={batch.batchId} wsId={wsId} folderId={batch.folderId} batchId={batch.batchId} onSettled={settle} />
        ))}
      </>
    ),
  };
}
