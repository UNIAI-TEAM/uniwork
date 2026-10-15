import { z } from "zod";
import {
  DOCUMENT_ACCESS_ERROR_CODES,
  DocumentAdminSummarySchema,
  DocumentAssetSchema,
  DocumentBreakGlassGrantEnvelopeSchema,
  DocumentBreakGlassGrantSchema,
  DocumentCommentEnvelopeSchema,
  DocumentDownloadSchema,
  DocumentEnvelopeSchema,
  DocumentUploadSchema,
  MentionCandidateSchema,
  type BreakGlassReasonInvalidError,
  type BreakGlassRequiredError,
  type Document,
  type DocumentAccessError,
  type DocumentAccessErrorCode,
  type DocumentAdminSummary,
  type DocumentAdminSummaryDocument,
  type DocumentAsset,
  type DocumentBreakGlassGrant,
  type DocumentComment,
  type DocumentCommentKind,
  type DocumentCommentMentionWithoutAccess,
  type DocumentDownload,
  type DocumentRestrictedError,
  type DocumentUpload,
  type DocumentVisibility,
  type MentionCandidate,
} from "../../types/document";
import { ApiError, request, requestBlob } from "../http";
import { parseWithFallback } from "../schema";

// Documents endpoints (C-01 §5 + §14; UNI-679, G1-05a). The transport returns
// unknown; every response here goes through parseWithFallback and a mutation
// resolves null when the answer cannot prove the write — hooks and the save
// machine turn that null into "result not verifiable" and keep dirty state.

const enc = encodeURIComponent;

/** Extra request controls for the mutations that carry an Idempotency-Key. */
export interface DocumentRequestOpts {
  /** Reused across retries of the same logical write (plan §14: the server
   *  dedupes on key + payload fingerprint). Mint one per user intent, not per
   *  attempt. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Multipart endpoints only: the filename the `file` part carries. A bare
   *  Blob has no name of its own, and the server reads a text document's type
   *  from the `.md` extension, so an upload that must sniff as markdown names
   *  its part. */
  filename?: string;
}

export interface CreateDocumentBody {
  title: string;
  /** "page" (default) or "folder" (a container with no content). A file
   *  document is created through createDocumentFile on the multipart route. */
  kind?: "page" | "folder";
  parent_id?: string;
  icon?: string;
  content?: unknown;
  visibility?: DocumentVisibility;
}

export interface PatchDocumentBody {
  /** Required base revision as a decimal string; a stale base answers 422
   *  revision_conflict with fields.current_revision. */
  revision: string;
  title?: string;
  /** Empty string clears the icon. */
  icon?: string;
  content?: unknown;
  visibility?: DocumentVisibility;
}

export interface CreateDocumentFileMeta {
  parent_id?: string;
  /** Display title; defaults to the file name server-side. */
  title?: string;
}

function idempotencyHeaders(opts?: DocumentRequestOpts): Record<string, string> | undefined {
  return opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined;
}

function fileForm(
  file: Blob,
  fields?: Record<string, string | undefined>,
  filename?: string,
): FormData {
  const form = new FormData();
  // Text fields must precede "file": the server reads text fields only before
  // the file part.
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value !== undefined) form.set(key, value);
  }
  // A File carries its own name into the part; a bare Blob takes the name the
  // caller supplies. An unnamed part is sniffed by bytes alone, which turns a
  // markdown document into text/plain and fails the commit's format check.
  if (filename !== undefined) form.set("file", file, filename);
  else form.set("file", file);
  return form;
}

/** POST /api/v1/workspaces/{workspaceID}/documents — create a page. */
export async function createDocument(
  wsId: string,
  body: CreateDocumentBody,
  opts?: DocumentRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents`, {
    method: "POST",
    body,
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/documents",
  })?.document ?? null;
}

/** GET /api/v1/documents/{documentID} — the working copy. */
export async function getDocument(documentId: string, signal?: AbortSignal): Promise<Document | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}`, { signal });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "GET /api/v1/documents/{id}",
  })?.document ?? null;
}

/**
 * PATCH /api/v1/documents/{documentID} — autosave + metadata edits of the
 * working copy. The response is the document with its bumped revision; null
 * means the write cannot be proven (caller keeps the draft and the key).
 */
export async function patchDocument(
  documentId: string,
  body: PatchDocumentBody,
  opts?: DocumentRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}`, {
    method: "PATCH",
    body,
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "PATCH /api/v1/documents/{id}",
  })?.document ?? null;
}

/**
 * POST /api/v1/workspaces/{workspaceID}/documents/files — one multipart call
 * that creates a file document whose bytes stream into FileService
 * (purpose document_file, ≤ 50 MiB, MIME allowlist, magic-byte check).
 */
export async function createDocumentFile(
  wsId: string,
  file: Blob,
  meta?: CreateDocumentFileMeta,
  opts?: DocumentRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/files`, {
    method: "POST",
    body: fileForm(file, { parent_id: meta?.parent_id, title: meta?.title }),
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/documents/files",
  })?.document ?? null;
}

/**
 * POST /api/v1/documents/{documentID}/uploads — stage the bytes of a
 * candidate file version. Returns the claim (upload_id IS the FileService
 * file_id) that commitDocumentVersion turns into a version (C-01 §14.4).
 * `opts.filename` names the part for a bare Blob: the server's type check
 * reads a text document's `.md` extension, so an unnamed markdown part would
 * be staged as text/plain and refused at commit with 415 format_changed.
 */
export async function uploadDocumentFile(
  documentId: string,
  file: Blob,
  opts?: DocumentRequestOpts,
): Promise<DocumentUpload | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/uploads`, {
    method: "POST",
    body: fileForm(file, undefined, opts?.filename),
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return parseWithFallback<DocumentUpload | null>(raw, DocumentUploadSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/uploads",
  });
}

/**
 * POST /api/v1/documents/{documentID}/assets — an image the page embeds via
 * asset://{id} (≤ 10 MiB, image MIME allowlist). The returned url is the Go
 * proxy route that serves the bytes, not a signed URL (C-01 §5.4).
 */
export async function uploadDocumentAsset(
  documentId: string,
  file: Blob,
  opts?: DocumentRequestOpts,
): Promise<DocumentAsset | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/assets`, {
    method: "POST",
    body: fileForm(file),
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return parseWithFallback<DocumentAsset | null>(raw, DocumentAssetSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/assets",
  });
}

/** The proxy path for one document asset. Native elements cannot attach the
 *  bearer token, so fetch it through getDocumentAsset and hand out a blob URL. */
export function documentAssetPath(documentId: string, assetId: string): string {
  return `/api/v1/documents/${enc(documentId)}/assets/${enc(assetId)}`;
}

/** GET the bytes of one document asset (auth via the transport's bearer). */
export async function getDocumentAsset(
  documentId: string,
  assetId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return requestBlob(documentAssetPath(documentId, assetId), { signal });
}

/** The download proxy path. With `meta=1` the same route answers the JSON
 *  descriptor read by getDocumentDownloadMeta. */
export function documentDownloadPath(documentId: string, version?: number): string {
  const p = new URLSearchParams();
  if (version !== undefined) p.set("version", String(version));
  const q = p.toString();
  return `/api/v1/documents/${enc(documentId)}/download${q ? `?${q}` : ""}`;
}

/**
 * GET /api/v1/documents/{documentID}/download?meta=1 — the descriptor of the
 * bytes the byte route serves: file_id, checksum, size, disposition. Lets a
 * caller show "what a download gets" without transferring the file.
 */
export async function getDocumentDownloadMeta(
  documentId: string,
  version?: number,
  signal?: AbortSignal,
): Promise<DocumentDownload | null> {
  const path = documentDownloadPath(documentId, version);
  const raw = await request(`${path}${path.includes("?") ? "&" : "?"}meta=1`, { signal });
  return parseWithFallback<DocumentDownload | null>(raw, DocumentDownloadSchema, null, {
    endpoint: "GET /api/v1/documents/{id}/download?meta=1",
  });
}

/** GET /api/v1/documents/{documentID}/download — the bytes of the live file
 *  version (or `version` when given) through the Go proxy. */
export async function downloadDocumentFile(
  documentId: string,
  version?: number,
  signal?: AbortSignal,
): Promise<Blob> {
  return requestBlob(documentDownloadPath(documentId, version), { signal });
}

// ---- G8-18 (UNI-1413): comment create/update + mention candidates ----------

export {
  DOCUMENT_ACCESS_ERROR_CODES,
  MentionCandidateSchema,
  type BreakGlassReasonInvalidError,
  type BreakGlassRequiredError,
  type DocumentAccessError,
  type DocumentAccessErrorCode,
  type DocumentAdminSummary,
  type DocumentAdminSummaryDocument,
  type DocumentBreakGlassGrant,
  type DocumentComment,
  type DocumentCommentKind,
  type DocumentCommentMentionWithoutAccess,
  type DocumentRestrictedError,
  type MentionCandidate,
};

export interface CreateDocumentCommentBody {
  body: string;
  parent_id?: string;
  kind?: DocumentCommentKind;
  anchor?: Record<string, unknown>;
  base_version_id?: string;
}

export interface UpdateDocumentCommentBody {
  body: string;
}

export interface DocumentCommentRequestOpts {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** POST /api/v1/documents/{documentID}/comments — create a comment or reply,
 *  including `mentions_without_access` when mentioned people cannot view (G8-18). */
export async function createDocumentComment(
  documentId: string,
  body: CreateDocumentCommentBody,
  opts?: DocumentCommentRequestOpts,
): Promise<DocumentComment | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/comments`, {
    method: "POST",
    body,
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return (
    parseWithFallback<{ comment: DocumentComment } | null>(raw, DocumentCommentEnvelopeSchema, null, {
      endpoint: "POST /api/v1/documents/{id}/comments",
    })?.comment ?? null
  );
}

/** PATCH /api/v1/documents/{documentID}/comments/{commentID} — edit a comment,
 *  including `mentions_without_access` when newly mentioned people cannot view (G8-18). */
export async function updateDocumentComment(
  documentId: string,
  commentId: string,
  body: UpdateDocumentCommentBody,
  opts?: { signal?: AbortSignal },
): Promise<DocumentComment | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/comments/${enc(commentId)}`, {
    method: "PATCH",
    body,
    signal: opts?.signal,
  });
  return (
    parseWithFallback<{ comment: DocumentComment } | null>(raw, DocumentCommentEnvelopeSchema, null, {
      endpoint: "PATCH /api/v1/documents/{id}/comments/{commentId}",
    })?.comment ?? null
  );
}

export interface MentionCandidateQuery {
  /** Search term over display name and email (accent-folded). */
  q?: string;
  /** Page size; clamped to [1, 50] with a default of 20. */
  limit?: number;
  /** Pass `"no_access"` to include workspace members who cannot view yet (`can_view: false`). */
  include?: "no_access";
  /** Convenience boolean alias for `include: "no_access"`. */
  includeNoAccess?: boolean;
}

const MentionCandidateListResponseSchema = z.object({
  candidates: z.array(z.unknown()).transform((rows): MentionCandidate[] => {
    const out: MentionCandidate[] = [];
    for (const row of rows) {
      const parsed = MentionCandidateSchema.safeParse(row);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }),
});

/** GET /api/v1/documents/{documentID}/mention-candidates — picker candidates,
 *  with optional `include=no_access` and tolerant `can_view` parsing (G8-18). */
export async function listDocumentMentionCandidates(
  documentId: string,
  query?: MentionCandidateQuery,
  signal?: AbortSignal,
): Promise<MentionCandidate[]> {
  const params = new URLSearchParams();
  const q = query?.q?.trim();
  if (q) params.set("q", q);
  if (query?.limit !== undefined) params.set("limit", String(query.limit));
  if (query?.include === "no_access" || query?.includeNoAccess) {
    params.set("include", "no_access");
  }
  const search = params.toString();
  const raw = await request(
    `/api/v1/documents/${enc(documentId)}/mention-candidates${search ? `?${search}` : ""}`,
    { signal },
  );
  return parseWithFallback<{ candidates: MentionCandidate[] }>(
    raw,
    MentionCandidateListResponseSchema,
    { candidates: [] },
    { endpoint: "GET /api/v1/documents/{id}/mention-candidates" },
  ).candidates;
}

// ---- DOC-05 (UNI-1628): break-glass + admin-summary + typed errors ---------

export interface BreakGlassDocumentBody {
  /** Audited emergency-access reason (10–500 runes after trim). */
  reason: string;
}

const BreakGlassGrantResponseSchema = z.union([
  DocumentBreakGlassGrantEnvelopeSchema.transform((v) => v.grant),
  DocumentBreakGlassGrantSchema,
]);

const BreakGlassStatusResponseSchema = z.object({
  status: z.string(),
});

function resolveSignal(opts?: { signal?: AbortSignal } | AbortSignal): AbortSignal | undefined {
  if (!opts) return undefined;
  if ("aborted" in opts) return opts;
  return opts.signal;
}

/**
 * POST /api/v1/documents/{documentID}/break-glass — open a 24h read-only
 * emergency-access grant (DOC-05, contract-g8-18-doc-05.md §3). Accepts `{ reason }`
 * or a plain reason string; resolves null when the response cannot prove the grant.
 */
export async function createDocumentBreakGlass(
  documentId: string,
  body: BreakGlassDocumentBody | string,
  opts?: DocumentRequestOpts,
): Promise<DocumentBreakGlassGrant | null> {
  const payload: BreakGlassDocumentBody = typeof body === "string" ? { reason: body } : body;
  const raw = await request(`/api/v1/documents/${enc(documentId)}/break-glass`, {
    method: "POST",
    body: payload,
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return parseWithFallback<DocumentBreakGlassGrant | null>(
    raw,
    BreakGlassGrantResponseSchema,
    null,
    { endpoint: "POST /api/v1/documents/{id}/break-glass" },
  );
}

export const grantDocumentBreakGlass = createDocumentBreakGlass;
export const openDocumentBreakGlass = createDocumentBreakGlass;

/**
 * DELETE /api/v1/documents/{documentID}/break-glass/{grantID} — end or revoke a
 * live emergency-access grant (DOC-05, contract-g8-18-doc-05.md §3). Proves the
 * revocation via `{ status: "ok" }` (`StatusSDO`).
 */
export async function revokeDocumentBreakGlass(
  documentId: string,
  grantId: string,
  opts?: DocumentRequestOpts | AbortSignal,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/documents/${enc(documentId)}/break-glass/${enc(grantId)}`,
    {
      method: "DELETE",
      signal: resolveSignal(opts),
    },
  );
  return (
    parseWithFallback<{ status: string }>(
      raw,
      BreakGlassStatusResponseSchema,
      { status: "" },
      { endpoint: "DELETE /api/v1/documents/{id}/break-glass/{grantId}" },
    ).status === "ok"
  );
}

export const deleteDocumentBreakGlass = revokeDocumentBreakGlass;

/**
 * GET /api/v1/documents/{documentID}/admin-summary — metadata-only summary for
 * a caller with `canAdminister()` (DOC-05, contract-g8-18-doc-05.md §3).
 */
export async function getDocumentAdminSummary(
  documentId: string,
  opts?: { signal?: AbortSignal } | AbortSignal,
): Promise<DocumentAdminSummary | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/admin-summary`, {
    signal: resolveSignal(opts),
  });
  return parseWithFallback<DocumentAdminSummary | null>(
    raw,
    DocumentAdminSummarySchema,
    null,
    { endpoint: "GET /api/v1/documents/{id}/admin-summary" },
  );
}

function extractRawError(err: unknown): {
  code: string;
  message: string;
  status: number;
  fields: Record<string, unknown> | undefined;
} | null {
  if (err instanceof ApiError) {
    return {
      code: typeof err.code === "string" ? err.code : "",
      message: typeof err.message === "string" ? err.message : "",
      status: typeof err.status === "number" ? err.status : 0,
      fields:
        err.fields && typeof err.fields === "object" && !Array.isArray(err.fields)
          ? err.fields
          : undefined,
    };
  }
  if (!err || typeof err !== "object" || Array.isArray(err)) return null;
  const record = err as Record<string, unknown>;
  const inner =
    record.error && typeof record.error === "object" && !Array.isArray(record.error)
      ? (record.error as Record<string, unknown>)
      : record;
  const code = typeof inner.code === "string" ? inner.code : "";
  if (!code) return null;
  const message = typeof inner.message === "string" ? inner.message : "";
  const status =
    typeof inner.status === "number"
      ? inner.status
      : typeof record.status === "number"
        ? record.status
        : 0;
  const rawFields = inner.fields ?? record.fields;
  const fields =
    rawFields && typeof rawFields === "object" && !Array.isArray(rawFields)
      ? (rawFields as Record<string, unknown>)
      : undefined;
  return { code, message, status, fields };
}

/**
 * Parse a failed documents call into a typed DOC-05 error (`document_restricted`
 * with `can_break_glass`, `break_glass_required`, or `break_glass_reason_invalid`)
 * so views can switch on `kind` / `code`. Malformed `fields` degrade safely.
 */
export function parseDocumentAccessError(err: unknown): DocumentAccessError | null {
  const extracted = extractRawError(err);
  if (!extracted) return null;
  switch (extracted.code) {
    case "document_restricted": {
      const canBreakGlass = extracted.fields?.can_break_glass === true;
      return {
        kind: "document_restricted",
        code: "document_restricted",
        canBreakGlass,
        can_break_glass: canBreakGlass,
        status: extracted.status || 403,
        message: extracted.message,
      };
    }
    case "break_glass_required":
      return {
        kind: "break_glass_required",
        code: "break_glass_required",
        status: extracted.status || 403,
        message: extracted.message,
      };
    case "break_glass_reason_invalid": {
      const rawMin = extracted.fields?.min;
      const rawMax = extracted.fields?.max;
      const rawLength = extracted.fields?.length;
      const min = typeof rawMin === "number" && Number.isFinite(rawMin) && rawMin > 0 ? rawMin : 10;
      const max = typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 500;
      const length =
        typeof rawLength === "number" && Number.isFinite(rawLength) && rawLength >= 0
          ? rawLength
          : undefined;
      return {
        kind: "break_glass_reason_invalid",
        code: "break_glass_reason_invalid",
        min,
        max,
        ...(length !== undefined ? { length } : {}),
        status: extracted.status || 422,
        message: extracted.message,
      };
    }
    default:
      return null;
  }
}

export const classifyDocumentAccessError = parseDocumentAccessError;

export function isDocumentRestrictedError(err: unknown): boolean {
  return parseDocumentAccessError(err)?.code === "document_restricted";
}

export function canBreakGlassFromError(err: unknown): boolean {
  const parsed = parseDocumentAccessError(err);
  return parsed?.code === "document_restricted" && parsed.can_break_glass;
}

export function isBreakGlassRequiredError(err: unknown): boolean {
  return parseDocumentAccessError(err)?.code === "break_glass_required";
}

export function isBreakGlassReasonInvalidError(err: unknown): boolean {
  return parseDocumentAccessError(err)?.code === "break_glass_reason_invalid";
}

