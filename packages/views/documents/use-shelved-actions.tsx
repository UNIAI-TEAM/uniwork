"use client";

import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { classifyDocumentError, isDocumentShelvedError, isFolderTooLargeError } from "@uniwork/core/documents/errors";
import { useShelveDocument, useUnshelveDocument } from "@uniwork/core/documents/hooks-collections";
import { documentKeys } from "@uniwork/core/documents/keys";
import type { DocumentArchive } from "@uniwork/core/types/document";
import { createSafeId } from "@uniwork/core/utils";
import { DocumentShelveDialog } from "./document-shelve-dialog";
import type { DocumentSummaryRow, LibraryRow } from "./library-rows";

export interface ShelvedActions {
  /** Lưu trữ (U-4): a folder opens its confirm dialog; anything else shelves at once with an undo toast. */
  onShelve: (doc: Pick<DocumentSummaryRow, "id" | "kind" | "title">) => void;
  /** Bỏ lưu trữ one item (U-3): awaits the server, then toasts; a partial folder unshelve says what stayed. */
  onUnshelve: (doc: DocumentSummaryRow) => void;
  /** Chuyển vào thùng rác from the shelved list goes through the caller's trash action (its own dialog). */
  isShelving: (documentId: string) => boolean;
  isUnshelving: (documentId: string) => boolean;
  /** The pending folder-shelve dialog, rendered beside the other row dialogs. */
  dialog: ReactNode;
  /** Direct shelve/unshelve for callers that hold the row themselves (the
   *  detail-page actions menu): same guards, same toasts. */
  runShelve: (doc: Pick<DocumentSummaryRow, "id" | "kind" | "title">) => void;
  runUnshelve: (doc: Pick<DocumentSummaryRow, "id" | "kind" | "title">) => void;
}

/** The ids of `root`'s descendants that are themselves rows of this shelved
 *  list — the children a folder unshelve may or may not take along. */
function shelvedDescendants(root: DocumentSummaryRow, rows: LibraryRow[]): Set<string> {
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

function titleOf(doc: Pick<DocumentSummaryRow, "id" | "title">, fallback: string): string {
  return doc.title || fallback;
}

/** The error copy of a failed shelve/unshelve: `folder_too_large` and the
 *  permission class use the archive list's own lines, `document_shelved`
 *  (already shelved, e.g. a race) says the item is read-only, anything else
 *  gets the fallback. */
function shelveErrorMessage(error: unknown, t: (key: string, options?: Record<string, unknown>) => string, fallbackKey: string): string {
  if (isFolderTooLargeError(error)) return t("documents.shelved_list.too_large");
  if (isDocumentShelvedError(error)) return t("documents.shelved_doc.write_blocked");
  if (classifyDocumentError(error).cls === "permission") return t("documents.shelved_list.no_permission");
  return t(fallbackKey);
}

/**
 * The shelve/unshelve commands (ARCHIVE-01 U-3/U-4). Shelving a document
 * awaits the server then toasts with a Hoàn tác action that unshelves it; a
 * folder goes through the dialog this hook owns (`archive-impact` counts).
 * Unshelving mirrors RESTORE-01's restore: one click one request, and a
 * folder whose same-batch shelved descendants the caller cannot manage says
 * so honestly. No optimistic update anywhere (State Rules).
 */
export function useShelvedActions({ wsId, rows }: { wsId: string; rows: LibraryRow[] }): ShelvedActions {
  const { t } = useTranslation();
  const shelve = useShelveDocument(wsId);
  const unshelve = useUnshelveDocument(wsId);
  const qc = useQueryClient();
  const [shelvingFolder, setShelvingFolder] = useState<Pick<DocumentSummaryRow, "id" | "kind" | "title"> | null>(null);
  // The refs answer a second click that lands before React re-renders; the
  // states drive the disabled buttons.
  const shelvingRef = useRef<Set<string>>(new Set());
  const unshelvingRef = useRef<Set<string>>(new Set());
  const [shelving, setShelving] = useState<ReadonlySet<string>>(new Set());
  const [unshelving, setUnshelving] = useState<ReadonlySet<string>>(new Set());
  const track = (ref: { current: Set<string> }, set: (next: ReadonlySet<string>) => void, documentId: string, on: boolean) => {
    if (on) ref.current.add(documentId);
    else ref.current.delete(documentId);
    set(new Set(ref.current));
  };

  const runShelve = (doc: Pick<DocumentSummaryRow, "id" | "kind" | "title">) => {
    if (shelvingRef.current.has(doc.id)) return;
    track(shelvingRef, setShelving, doc.id, true);
    void shelve.mutateAsync({ documentId: doc.id, idempotencyKey: createSafeId() }).then(
      (result: DocumentArchive) => {
        const title = titleOf(result.document, doc.title) || t("documents.detail.untitled");
        toast.success(t("documents.shelved_list.toast.shelved", { title }), {
          action: {
            label: t("documents.shelved_list.undo"),
            onClick: () => {
              if (unshelvingRef.current.has(doc.id)) return;
              track(unshelvingRef, setUnshelving, doc.id, true);
              void unshelve.mutateAsync({ documentId: doc.id, idempotencyKey: createSafeId() }).then(
                () => toast.success(t("documents.shelved_list.toast.unshelved", { title })),
                (failure: unknown) => toast.error(shelveErrorMessage(failure, t, "documents.shelved_list.unshelve_failed")),
              ).finally(() => track(unshelvingRef, setUnshelving, doc.id, false));
            },
          },
        });
      },
      (failure: unknown) => {
        toast.error(shelveErrorMessage(failure, t, "documents.shelved_list.shelve_failed"));
        // Already shelved by someone else: the row is stale, so reread the lists.
        if (isDocumentShelvedError(failure)) void qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
      },
    ).finally(() => track(shelvingRef, setShelving, doc.id, false));
  };

  const onShelve = (doc: Pick<DocumentSummaryRow, "id" | "kind" | "title">) => {
    if (doc.kind === "folder") {
      setShelvingFolder(doc);
      return;
    }
    runShelve(doc);
  };

  const runUnshelve = (doc: Pick<DocumentSummaryRow, "id" | "kind" | "title">) => {
    if (unshelvingRef.current.has(doc.id)) return;
    track(unshelvingRef, setUnshelving, doc.id, true);
    // The descendants this folder could leave behind are the rows the list
    // shows BEFORE the mutation; read them now, the refetch comes with it.
    const left = doc.kind === "folder" ? shelvedDescendants(doc as DocumentSummaryRow, rows) : new Set<string>();
    void unshelve.mutateAsync({ documentId: doc.id, idempotencyKey: createSafeId() }).then(
      (result: DocumentArchive) => {
        const title = titleOf(result.document, doc.title) || t("documents.detail.untitled");
        const base = t("documents.shelved_list.toast.unshelved", { title });
        const partial = [...left].filter((id) => !result.affected.includes(id)).length > 0;
        if (partial) toast.success(base, { description: t("documents.shelved_list.toast.left_shelved") });
        else toast.success(base);
      },
      (failure: unknown) => {
        toast.error(shelveErrorMessage(failure, t, "documents.shelved_list.unshelve_failed"));
        // Someone else already unshelved or trashed it: the row is stale, so reread the list.
        if (classifyDocumentError(failure).cls === "missing") void qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
      },
    ).finally(() => track(unshelvingRef, setUnshelving, doc.id, false));
  };

  const onUnshelve = (doc: DocumentSummaryRow) => runUnshelve(doc);

  return {
    onShelve,
    onUnshelve,
    isShelving: (documentId) => shelving.has(documentId),
    isUnshelving: (documentId) => unshelving.has(documentId),
    dialog: shelvingFolder ? (
      <DocumentShelveDialog
        open
        onOpenChange={(next) => {
          if (!next) setShelvingFolder(null);
        }}
        wsId={wsId}
        doc={shelvingFolder}
      />
    ) : null,
    runShelve,
    runUnshelve,
  };
}
