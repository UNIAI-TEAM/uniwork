"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revokeDocumentBreakGlass } from "../api/endpoints/documents";
import { revokeDocumentLink, revokeDocumentShare } from "../api/endpoints/documents-sharing";
import type { AccessReportRevokeTarget } from "../types/document-access-report";
import { invalidateDocumentLists } from "./invalidate-lists";
import { documentKeys } from "./keys";

// Revoke from the access report (UNI-2039). No new route: the report row's
// `revoke_target` only says which existing revoke route to call. The service
// gate stays the authority, so a refused call surfaces as an error and the
// report is left as it was; nothing here is optimistic.

export interface RevokeReportGrantInput {
  documentId: string;
  target: AccessReportRevokeTarget;
}

export function useRevokeReportGrant(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ documentId, target }: RevokeReportGrantInput): Promise<void> => {
      switch (target.kind) {
        case "share":
          await revokeDocumentShare(documentId, target.id);
          return;
        case "link":
          await revokeDocumentLink(documentId, target.id);
          return;
        case "break_glass":
          await revokeDocumentBreakGlass(documentId, target.id);
          return;
        default:
          throw new Error("access_report_revoke_unknown_target");
      }
    },
    onSuccess: async (_data, { documentId, target }) => {
      void invalidateDocumentLists(qc, wsId);
      await Promise.all([
        qc.invalidateQueries({ queryKey: documentKeys.accessReportRoot(wsId) }),
        qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) }),
        qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) }),
        ...(target.kind === "break_glass"
          ? [qc.invalidateQueries({ queryKey: documentKeys.accessLogs(wsId, documentId) })]
          : []),
      ]);
    },
  });
}
