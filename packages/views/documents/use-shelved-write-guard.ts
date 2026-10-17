"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { isDocumentShelvedError } from "@uniwork/core/documents/errors";
import { documentKeys } from "@uniwork/core/documents/keys";

/** One toast id, so a refusal heard twice (autosave and a rename) reads as one message. */
const SHELVED_TOAST_ID = "document-shelved-write";

/** The single sentence every web write shows when the document went to "Lưu trữ" under it (U-10). */
export function notifyDocumentShelved(t: (key: string) => string) {
  toast.error(t("documents.shelved_doc.write_blocked"), { id: SHELVED_TOAST_ID });
}

/**
 * U-10 for the open document page. Any write that answers `document_shelved` —
 * a mutation (rename, comment, version, create child) or the page autosave
 * machine (its `errorCode`) — reads the document again, so the page turns
 * read-only for someone who was editing while another person shelved it. The
 * autosave refusal is also announced here and returned, so the caller stops
 * writing and keeps the unsaved editor content.
 */
export function useShelvedWriteGuard(wsId: string, documentId: string, saveErrorCode: string | null): boolean {
  const qc = useQueryClient();
  const { t } = useTranslation();
  useEffect(
    () =>
      qc.getMutationCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error") return;
        if (!isDocumentShelvedError(event.action.error)) return;
        void qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) });
      }),
    [qc, wsId, documentId],
  );
  const refused = saveErrorCode === "document_shelved";
  useEffect(() => {
    if (!refused) return;
    notifyDocumentShelved(t);
    void qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) });
  }, [refused, qc, t, wsId, documentId]);
  return refused;
}
