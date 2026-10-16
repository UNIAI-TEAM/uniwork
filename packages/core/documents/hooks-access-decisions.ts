"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode } from "../api/http";
import { DocumentNotVerifiableError } from "../types/document";
import {
  approveDocumentAccessRequest,
  declineDocumentAccessRequest,
  listDocumentAccessRequests,
  type DocumentAccessRequestDecision,
  type DocumentAccessRequestLevel,
} from "../api/endpoints/documents-access-requests";
import { documentKeys } from "./keys";

/**
 * The pending access requests of one document, for the people who administer
 * it (access addendum §3.4, §4.3; W-DOC07 B). The server answers an empty list
 * to a reader who does not administer, so the section is gated by the caller,
 * not by this read. Off until the share dialog is open.
 */
export function useDocumentAccessRequests(wsId: string, documentId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: documentKeys.accessRequests(wsId, documentId),
    queryFn: ({ signal }) => listDocumentAccessRequests(documentId, signal),
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
  });
}

/** An answer that does not name this request and the status is no proof of the write. */
function verified(
  res: DocumentAccessRequestDecision | null,
  requestId: string,
  status: "approved" | "declined",
): DocumentAccessRequestDecision {
  if (!res || res.id !== requestId || res.status !== status) throw new DocumentNotVerifiableError();
  return res;
}

function useDecisionInvalidation(wsId: string, documentId: string) {
  const qc = useQueryClient();
  const requests = () => qc.invalidateQueries({ queryKey: documentKeys.accessRequests(wsId, documentId) });
  return {
    // Approve may have created a share; decline changes only the list, but the
    // dialog's pending count rides on `shares`, so both refresh together.
    onSuccess: () =>
      Promise.all([requests(), qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) })]),
    // 409 access_request_closed: someone else handled it or it expired, so the
    // list the manager is looking at is stale.
    onError: (err: unknown) => (errorCode(err) === "access_request_closed" ? requests() : undefined),
  };
}

/**
 * Approve a request at a level (§3.1 "Duyệt"). A permission change, so it
 * awaits the server: no row leaves the list until the answer is verified.
 */
export function useApproveDocumentAccessRequest(wsId: string, documentId: string) {
  const invalidation = useDecisionInvalidation(wsId, documentId);
  return useMutation({
    mutationFn: async (vars: { requestId: string; level: DocumentAccessRequestLevel }) =>
      verified(
        await approveDocumentAccessRequest(documentId, vars.requestId, { level: vars.level }),
        vars.requestId,
        "approved",
      ),
    ...invalidation,
  });
}

/** Decline a request (§3.1 "Từ chối"); the requester is told it was declined, never why. */
export function useDeclineDocumentAccessRequest(wsId: string, documentId: string) {
  const invalidation = useDecisionInvalidation(wsId, documentId);
  return useMutation({
    mutationFn: async (vars: { requestId: string }) =>
      verified(await declineDocumentAccessRequest(documentId, vars.requestId), vars.requestId, "declined"),
    ...invalidation,
  });
}
