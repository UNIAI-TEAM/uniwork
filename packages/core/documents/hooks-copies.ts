"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { copyDocument, type CopyDocumentBody } from "../api/endpoints/documents-copies";
import { documentKeys } from "./keys";
import { requireVerifiableDocument } from "./verify";

// Document copies (G2-07a surface; C-01 §14.4). The copy is a new standalone
// document carrying the source's ACL snapshot, so the answer must prove the
// new document exists (id + revision) before the caller may treat the copy as
// created; a null parse throws "result not verifiable" and the caller keeps
// its Idempotency-Key for the retry.

/** Copy one file document; the copy is a new document in the same workspace. */
export function useCopyDocument(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CopyDocumentBody & { documentId: string; idempotencyKey?: string }) => {
      const { documentId, idempotencyKey, ...body } = input;
      return requireVerifiableDocument(await copyDocument(documentId, body, { idempotencyKey }));
    },
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}
