"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { isDocumentShelvedError } from "@uniwork/core/documents/errors";
import { documentKeys } from "@uniwork/core/documents/keys";
import { isShelved, type Document } from "@uniwork/core/types/document";

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
 * writing and keeps the unsaved editor content. When the document read again
 * after that refusal is not shelved (unshelved in between), `onLiveAgain`
 * lets the caller send its held draft again.
 */
export function useShelvedWriteGuard(
  wsId: string,
  documentId: string,
  saveErrorCode: string | null,
  onLiveAgain?: () => void,
): boolean {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const onLiveAgainRef = useRef(onLiveAgain);
  onLiveAgainRef.current = onLiveAgain;
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
    const key = documentKeys.detail(wsId, documentId);
    void qc.invalidateQueries({ queryKey: key }).then(() => {
      const fresh = qc.getQueryData<Document | null>(key);
      if (fresh && !isShelved(fresh)) onLiveAgainRef.current?.();
    });
  }, [refused, qc, t, wsId, documentId]);
  return refused;
}
