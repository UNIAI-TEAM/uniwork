import { DocumentEnvelopeSchema, type Document } from "../../types/document";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Office document endpoint: the explicit copy. The response goes through
// parseWithFallback and a malformed answer degrades to null, the same rule as
// the rest of the Documents surface.

const enc = encodeURIComponent;

interface OfficeRequestOpts {
  /** Mint one key per user intent; retries of that intent reuse it. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface CopyDocumentBody {
  /** Must be "copy": the server answers copy_consent_required otherwise. */
  consent: "copy";
  upload_id?: string;
  title?: string;
  parent_id?: string;
}

/** POST /api/v1/documents/{id}/copies — an explicit copy that keeps the
 *  source's ACL snapshot and records provenance. */
export async function copyDocument(
  documentId: string,
  body: CopyDocumentBody,
  opts?: OfficeRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/copies`, {
    method: "POST",
    body,
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return (
    parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
      endpoint: "POST /api/v1/documents/{id}/copies",
    })?.document ?? null
  );
}
