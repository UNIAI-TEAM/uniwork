"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDocumentBreakGlass,
  getDocumentAdminSummary,
  revokeDocumentBreakGlass,
} from "../api/endpoints/documents";
import { documentKeys } from "./keys";

// DOC-05 (UNI-1628) server state for the break-glass flow: the metadata-only
// admin summary an admin-only caller may read, and the grant / end-access
// mutations. A grant or an end changes what the detail, the access list and
// the access log answer, so all three invalidate together.

/**
 * GET /documents/{id}/admin-summary. Enabled only when the caller may need it
 * (a restricted answer, an admin-scope row or a live grant): the route is
 * refused below manage, so it is never fetched speculatively.
 */
export function useDocumentAdminSummary(wsId: string, documentId: string, enabled = true) {
  return useQuery({
    queryKey: documentKeys.adminSummary(wsId, documentId),
    queryFn: ({ signal }) => getDocumentAdminSummary(documentId, { signal }),
    enabled: Boolean(wsId) && Boolean(documentId) && enabled,
    retry: false,
  });
}

function useInvalidateAfterBreakGlass(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) }),
      qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) }),
      qc.invalidateQueries({ queryKey: documentKeys.accessLogs(wsId, documentId) }),
    ]);
}

/** Open a 24h read-only emergency grant with an audited reason. */
export function useGrantDocumentBreakGlass(wsId: string, documentId: string) {
  const invalidate = useInvalidateAfterBreakGlass(wsId, documentId);
  return useMutation({
    mutationFn: (reason: string) => createDocumentBreakGlass(documentId, { reason }),
    onSuccess: invalidate,
  });
}

/** End one live grant by its real id; never called with a guessed id. */
export function useRevokeDocumentBreakGlass(wsId: string, documentId: string) {
  const invalidate = useInvalidateAfterBreakGlass(wsId, documentId);
  return useMutation({
    mutationFn: (grantId: string) => revokeDocumentBreakGlass(documentId, grantId),
    onSuccess: invalidate,
  });
}
