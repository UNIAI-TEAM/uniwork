"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  transferDocumentOwner,
  type DocumentOwnerTransfer,
  type TransferDocumentOwnerBody,
} from "../api/endpoints/documents-owner";
import { DocumentNotVerifiableError } from "../types/document";
import { documentKeys } from "./keys";

/**
 * Transfer one document's ACL owner (access addendum §2.1, §2.4; W-DOC06).
 * A permission change, so it awaits the server (no optimistic owner); an
 * answer that does not name the requested owner is not proof of the write.
 * Success invalidates the document (its `shares` hang off the detail key)
 * and the workspace's list roots, where the owner badge and levels live.
 */
export function useTransferDocumentOwner(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: TransferDocumentOwnerBody): Promise<DocumentOwnerTransfer> => {
      const res = await transferDocumentOwner(documentId, body);
      if (!res || res.document_id !== documentId || res.acl_owner_id !== body.user_id) {
        throw new DocumentNotVerifiableError();
      }
      return res;
    },
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) }),
        qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) }),
      ]),
  });
}
