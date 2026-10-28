import {
  DocumentEnvelopeSchema,
  DocumentListSchema,
  type Document,
  type DocumentList,
} from "../../types/document";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { listQuery, type ListDocumentsBaseOpts } from "./documents-collections";

// Document template endpoints (Templates section). A template is a document
// the workspace marks as a starting point; marking never copies or moves it.

const enc = encodeURIComponent;

/** POST /api/v1/documents/{documentID}/template - marks a document as a
 *  template. A restricted document answers 409 `template_widens_visibility`
 *  until the caller repeats with `widenToWorkspace`. Null means the answer
 *  cannot be proven. */
export async function markDocumentTemplate(
  documentId: string,
  opts?: { widenToWorkspace?: boolean },
): Promise<{ document: Document } | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/template`, {
    method: "POST",
    body: opts?.widenToWorkspace ? { widen_to_workspace: true } : undefined,
  });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/template",
  });
}

/** DELETE /api/v1/documents/{documentID}/template - removes the mark; the
 *  document itself stays. Null means the answer cannot be proven. */
export async function unmarkDocumentTemplate(documentId: string): Promise<{ document: Document } | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/template`, { method: "DELETE" });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "DELETE /api/v1/documents/{id}/template",
  });
}

/** GET /api/v1/workspaces/{workspaceID}/documents/templates - the marked
 *  documents the caller may read, keyset-paged. An untrusted answer throws
 *  rather than render an empty section. */
export async function listTemplateDocuments(
  wsId: string,
  opts?: ListDocumentsBaseOpts,
  signal?: AbortSignal,
): Promise<DocumentList> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/templates${listQuery(opts)}`, { signal });
  const parsed = parseWithFallback<DocumentList | null>(raw, DocumentListSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/documents/templates",
  });
  if (!parsed) throw new Error("document_list_invalid");
  return parsed;
}
