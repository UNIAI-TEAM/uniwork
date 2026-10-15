// The one seam between the manager side of access requests (W-DOC07 B) and
// worker A's core endpoint file. Until A merges, the names come from the
// local stand-in; the merge is a two-line change here: point the `from` at
// "../api/endpoints/documents-access-requests" and return
// `documentKeys.accessRequests(wsId, documentId)` from `accessRequestsKey`.
import { documentKeys } from "./keys";

export {
  approveDocumentAccessRequest,
  declineDocumentAccessRequest,
  listDocumentAccessRequests,
  type DocumentAccessRequest,
  type DocumentAccessRequestDecision,
  type DocumentAccessRequestLevel,
} from "../api/endpoints/documents-access-requests-local";

/** `[...documentKeys.detail(wsId, id), "access-requests"]`, as §3.4 names it. */
export function accessRequestsKey(wsId: string, documentId: string) {
  return [...documentKeys.detail(wsId, documentId), "access-requests"] as const;
}
