import {
  DocumentVersionEnvelopeSchema,
  DocumentVersionListEnvelopeSchema,
  DocumentVersionResultEnvelopeSchema,
  type DocumentVersion,
  type DocumentVersionResult,
} from "../../types/document";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import type { DocumentRequestOpts } from "./documents";

// Document version endpoints (C-01 §5.3 + §14.4; UNI-679, G1-05a). Commit is
// the single save shape for file documents: a staged upload_id + the base
// revision the edit started from.

const enc = encodeURIComponent;

export interface ListDocumentVersionsOpts {
  cursor?: string;
  limit?: number;
}

export interface DocumentVersionList {
  versions: DocumentVersion[];
  nextCursor: string | null;
}

function versionQuery(opts?: ListDocumentVersionsOpts): string {
  if (!opts) return "";
  const p = new URLSearchParams();
  if (opts.cursor) p.set("cursor", opts.cursor);
  if (opts.limit !== undefined) p.set("limit", String(opts.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * GET /api/v1/documents/{documentID}/versions — metadata rows, newest first.
 * Does not degrade to an empty page: [] would render "no versions" over a
 * document that has them, so a malformed answer throws and the query lands in
 * its error state with a retry.
 */
export async function listDocumentVersions(
  documentId: string,
  opts?: ListDocumentVersionsOpts,
  signal?: AbortSignal,
): Promise<DocumentVersionList> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/versions${versionQuery(opts)}`, { signal });
  const parsed = parseWithFallback<{ versions: DocumentVersion[]; next_cursor?: string | null } | null>(
    raw,
    DocumentVersionListEnvelopeSchema,
    null,
    { endpoint: "GET /api/v1/documents/{id}/versions" },
  );
  if (!parsed) throw new Error("document_versions_invalid");
  return { versions: parsed.versions, nextCursor: parsed.next_cursor ?? null };
}

/**
 * GET /api/v1/documents/{documentID}/versions/{versionNo} — one version;
 * page versions carry their content here.
 */
export async function getDocumentVersion(
  documentId: string,
  versionNo: number,
  signal?: AbortSignal,
): Promise<DocumentVersion | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/versions/${enc(String(versionNo))}`, {
    signal,
  });
  return parseWithFallback<{ version: DocumentVersion } | null>(raw, DocumentVersionEnvelopeSchema, null, {
    endpoint: "GET /api/v1/documents/{id}/versions/{no}",
  })?.version ?? null;
}

/**
 * POST /api/v1/documents/{documentID}/versions — a named manual checkpoint of
 * the working copy. 409 document_version_unchanged when nothing moved since
 * the newest version.
 */
export async function createDocumentVersion(
  documentId: string,
  body: { label?: string } = {},
  opts?: DocumentRequestOpts,
): Promise<DocumentVersion | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/versions`, {
    method: "POST",
    body,
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return parseWithFallback<{ version: DocumentVersion } | null>(raw, DocumentVersionEnvelopeSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/versions",
  })?.version ?? null;
}

export interface CommitDocumentVersionBody {
  /** upload_id (= FileService file_id) from uploadDocumentFile or an Office
   *  engine output registered with FileService. */
  upload_id: string;
  /** Revision the edit started from, as a decimal string; a stale base
   *  answers 409 document_version_conflict. */
  base_revision: string;
}

/**
 * POST /api/v1/documents/{documentID}/versions/commit — the single save shape
 * for file documents (C-01 §14.4). Requires an Idempotency-Key: the server
 * dedupes on key + payload fingerprint so a retried commit cannot create two
 * versions of one upload.
 */
export async function commitDocumentVersion(
  documentId: string,
  body: CommitDocumentVersionBody,
  opts?: DocumentRequestOpts,
): Promise<DocumentVersionResult | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/versions/commit`, {
    method: "POST",
    body,
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return parseWithFallback<DocumentVersionResult | null>(raw, DocumentVersionResultEnvelopeSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/versions/commit",
  });
}

/**
 * POST /api/v1/documents/{documentID}/versions/{versionNo}/restore — makes
 * the chosen version the working copy and records a new restore version.
 * Returns the bumped document plus the new version row; null means the
 * restore cannot be proven.
 *
 * The body is optional: a file restore must name the base the writer saw
 * (the service checks base_revision unconditionally on files) — pass it via
 * opts.baseRevision; page restores send none.
 */
export async function restoreDocumentVersion(
  documentId: string,
  versionNo: number,
  opts?: DocumentRequestOpts & { baseRevision?: string },
): Promise<DocumentVersionResult | null> {
  const raw = await request(
    `/api/v1/documents/${enc(documentId)}/versions/${enc(String(versionNo))}/restore`,
    {
      method: "POST",
      headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
      body: opts?.baseRevision ? { base_revision: opts.baseRevision } : undefined,
      signal: opts?.signal,
    },
  );
  return parseWithFallback<DocumentVersionResult | null>(raw, DocumentVersionResultEnvelopeSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/versions/{no}/restore",
  });
}
