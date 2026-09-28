import { DocumentEnvelopeSchema, type Document } from "../../types/document";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import type { DocumentRequestOpts } from "./documents";

// Document copies (G2-07a surface; C-01 §14.4): POST
// /api/v1/documents/{documentID}/copies with `consent: "copy"`. The command is
// a standalone copy of a FILE document: it keeps the source's ACL snapshot and
// visibility (never widening access), records provenance
// (source_document_id/version/revision/checksum/format) and reuses the same
// FileService bytes, so storage is counted once. A page is refused by name
// (400 document_invalid, reason page_copy_not_supported); an owned document
// refuses with 409 owner_requires_copy.
//
// The G2-07a lane owns the server route; until it reaches the integration
// branch a 404/501 is the only answer, and the caller hides the action on it.

const enc = encodeURIComponent;

export interface CopyDocumentBody {
  /** Must be "copy": a lossy or re-scoped copy is an explicit choice. */
  consent: "copy";
  /** Title of the copy; absent means "<source> (bản sao)" server-side. */
  title?: string;
  /** Parent of the copy; absent means the workspace root. */
  parent_id?: string;
}

/**
 * POST /api/v1/documents/{documentID}/copies — copy a file document. Null
 * means the write cannot be proven; the caller keeps its state and its
 * Idempotency-Key. 409 copy_consent_required / owner_requires_copy and the
 * page refusal are classified by the caller through the error envelope.
 */
export async function copyDocument(
  documentId: string,
  body: CopyDocumentBody,
  opts?: DocumentRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/copies`, {
    method: "POST",
    body,
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/copies",
  })?.document ?? null;
}
