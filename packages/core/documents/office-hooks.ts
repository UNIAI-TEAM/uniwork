"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { copyDocument, type CopyDocumentBody } from "../api/endpoints/office";
import { DocumentNotVerifiableError } from "../types/document";
import { documentKeys } from "./keys";

// Office document hooks. A copy is a server-side write, so an answer that
// cannot prove it throws "result not verifiable" instead of pretending
// success. Every key carries the workspace id beside the document id.

export const officeKeys = {
  all: ["office"] as const,
  document: (wsId: string, documentId: string) =>
    [...officeKeys.all, wsId, documentId] as const,
};

/** Copy a document (consent: "copy"); the copy joins the workspace tree. */
export function useCopyDocument(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CopyDocumentBody, "consent"> & { idempotencyKey?: string }) => {
      const { idempotencyKey, ...rest } = input;
      const doc = await copyDocument(
        documentId,
        { consent: "copy", ...rest },
        { idempotencyKey },
      );
      if (!doc?.id) throw new DocumentNotVerifiableError();
      return doc;
    },
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}
