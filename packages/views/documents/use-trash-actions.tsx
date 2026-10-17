"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useRestoreDocument } from "@uniwork/core/documents/hooks-collections";
import type { DocumentArchive } from "@uniwork/core/types/document";
import { createSafeId } from "@uniwork/core/utils";
import { DocumentPurgeDialog } from "./document-purge-dialog";
import { trashErrorMessage } from "./document-error-message";
import type { DocumentSummaryRow, LibraryRow } from "./library-rows";

export interface TrashActions {
  /** Restore one item (RESTORE-01 §1): awaits the server, then toasts where it landed. */
  onRestore: (doc: DocumentSummaryRow) => void;
  /** Open the permanent-delete confirmation for one item (RESTORE-01 §2). */
  onPurge: (doc: DocumentSummaryRow) => void;
  /** The pending purge dialog, rendered beside the other row dialogs. */
  dialog: ReactNode;
}

/** The ids of `root`'s descendants that are themselves rows of this trash
 *  list — the children a folder restore may or may not take along. */
function trashedDescendants(root: DocumentSummaryRow, rows: LibraryRow[]): Set<string> {
  const byParent = new Map<string, DocumentSummaryRow[]>();
  for (const row of rows) {
    if (row.type !== "document" || !row.doc.parent_id) continue;
    const siblings = byParent.get(row.doc.parent_id) ?? [];
    siblings.push(row.doc);
    byParent.set(row.doc.parent_id, siblings);
  }
  const out = new Set<string>();
  const queue = [...(byParent.get(root.id) ?? [])];
  while (queue.length) {
    const next = queue.shift()!;
    if (out.has(next.id)) continue;
    out.add(next.id);
    queue.push(...(byParent.get(next.id) ?? []));
  }
  return out;
}

/** Where the restored item landed, for the toast: its old folder when the
 *  server sent one (the parent's breadcrumb names it), the workspace root
 *  when the answer carries `parent_id: null`, and null when an older server
 *  does not say — the toast stays neutral then (contract item 3). */
function restoreDestination(result: DocumentArchive): { root: boolean; folder: string | null } {
  const doc = result.document;
  if (!("parent_id" in doc) || doc.parent_id === undefined) return { root: false, folder: null };
  if (doc.parent_id === null) return { root: true, folder: null };
  const folder = [...(doc.breadcrumbs ?? [])].reverse().find((crumb) => crumb.id === doc.parent_id)?.title ?? null;
  return { root: false, folder };
}

/**
 * The trash table's row commands (RESTORE-01). Restore runs at once — it is
 * not destructive, and per R-3 the answer's document says where the item
 * landed. A folder restore that left trashed descendants it cannot manage
 * behind says so honestly: the still-listed descendants are diffed against
 * the answer's `affected` ids. Purge waits for the AlertDialog this hook
 * owns. No optimistic update anywhere (State Rules).
 */
export function useTrashActions({ wsId, rows }: { wsId: string; rows: LibraryRow[] }): TrashActions {
  const { t } = useTranslation();
  const restore = useRestoreDocument(wsId);
  const [purging, setPurging] = useState<DocumentSummaryRow | null>(null);

  const onRestore = (doc: DocumentSummaryRow) => {
    // The descendants this folder could leave behind are the rows the list
    // shows BEFORE the mutation; read them now, the refetch comes with it.
    const left = doc.kind === "folder" ? trashedDescendants(doc, rows) : new Set<string>();
    void restore.mutateAsync({ documentId: doc.id, idempotencyKey: createSafeId() }).then(
      (result) => {
        const title = result.document.title || doc.title || t("documents.detail.untitled");
        const dest = restoreDestination(result);
        const base = dest.root
          ? t("documents.trash.toast.restored_root", { title })
          : dest.folder
            ? t("documents.trash.toast.restored_folder", { title, folder: dest.folder })
            : t("documents.trash.toast.restored", { title });
        const partial = [...left].filter((id) => !result.affected.includes(id)).length > 0;
        toast.success(partial ? `${base} ${t("documents.trash.toast.left_in_trash")}` : base);
      },
      (failure: unknown) => toast.error(trashErrorMessage(failure, t, "documents.trash.restore_failed")),
    );
  };

  return {
    onRestore,
    onPurge: (doc) => setPurging(doc),
    dialog: purging ? (
      <DocumentPurgeDialog
        open
        onOpenChange={(next) => {
          if (!next) setPurging(null);
        }}
        wsId={wsId}
        doc={purging}
      />
    ) : null,
  };
}
