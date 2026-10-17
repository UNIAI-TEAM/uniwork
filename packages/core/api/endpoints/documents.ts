import { z } from "zod";
import {
  DocumentAssetSchema,
  DocumentDownloadSchema,
  DocumentEnvelopeSchema,
  DocumentUploadSchema,
  type Document,
  type DocumentAsset,
  type DocumentDownload,
  type DocumentUpload,
  type DocumentVisibility,
} from "../../types/document";
import {
  DocumentAdminSummarySchema,
  DocumentBreakGlassGrantEnvelopeSchema,
  DocumentBreakGlassGrantSchema,
  type DocumentAccessError,
  type DocumentAdminSummary,
  type DocumentBreakGlassGrant,
} from "../../types/document-access";
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

export const DOCUMENT_DESTINATIONS = ["my_folder"] as const;
export type DocumentCreateDestination = (typeof DOCUMENT_DESTINATIONS)[number];

type CreateDocumentPlacementWire =
  | { parent_id?: string; destination?: never }
  | { destination?: DocumentCreateDestination; parent_id?: never };

export type CreateDocumentBody = {
  title: string;
  /** "page" (default) or "folder" (a container with no content). A file
   *  document is created through createDocumentFile on the multipart route. */
  kind?: "page" | "folder";
  icon?: string;
  content?: unknown;
  visibility?: DocumentVisibility;
} & CreateDocumentPlacementWire;

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

export type CreateDocumentFileMeta = {
  /** Display title; defaults to the file name server-side. */
  title?: string;
} & (
  | { parent_id?: string; parentId?: string; destination?: never }
  | { destination?: DocumentCreateDestination; parent_id?: never; parentId?: never }
);

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

/**
 * POST /api/v1/workspaces/{workspaceID}/documents/my-folder — lazily ensure
 * the caller's personal root folder ("My Folder") and return its DocumentSDO.
 * Naturally idempotent per (workspace, caller) on the server.
 */
export async function ensureMyFolder(
  wsId: string,
  opts?: DocumentRequestOpts | AbortSignal,
): Promise<Document | null> {
  const signal = opts instanceof AbortSignal ? opts : opts?.signal;
  const headers = opts && !(opts instanceof AbortSignal) ? idempotencyHeaders(opts) : undefined;
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/my-folder`, {
    method: "POST",
    headers,
    signal,
  });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/documents/my-folder",
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
 * (purpose document_file, ≤ the configured DOCUMENT_MAX_BYTES cap — see
 * documents.limits in GET /api/v1/config — MIME allowlist, magic-byte check).
 */
export async function createDocumentFile(
  wsId: string,
  file: Blob,
  meta?: CreateDocumentFileMeta,
  opts?: DocumentRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/files`, {
    method: "POST",
    body: fileForm(file, {
      parent_id: meta?.parent_id ?? meta?.parentId,
      destination: meta?.destination,
      title: meta?.title,
    }),
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

// ---- DOC-05 (UNI-1628): break-glass + admin-summary + typed errors ---------

export interface BreakGlassDocumentBody {
  /** Audited emergency-access reason (10–500 runes after trim). */
  reason: string;
}

const BreakGlassGrantResponseSchema = z.union([
  DocumentBreakGlassGrantEnvelopeSchema.transform((v) => v.grant),
  DocumentBreakGlassGrantSchema,
]);

const BreakGlassStatusResponseSchema = z.object({ status: z.string() });

/** POST /api/v1/documents/{documentID}/break-glass — open a 24h read-only grant (DOC-05). */
export async function createDocumentBreakGlass(
  documentId: string,
  body: BreakGlassDocumentBody,
  opts?: DocumentRequestOpts,
): Promise<DocumentBreakGlassGrant | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/break-glass`, {
    method: "POST",
    body,
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

/** DELETE /api/v1/documents/{documentID}/break-glass/{grantID} — revoke a live grant (DOC-05). */
export async function revokeDocumentBreakGlass(
  documentId: string,
  grantId: string,
  opts?: DocumentRequestOpts,
): Promise<boolean> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/break-glass/${enc(grantId)}`, {
    method: "DELETE",
    signal: opts?.signal,
  });
  return (
    parseWithFallback<{ status: string }>(
      raw,
      BreakGlassStatusResponseSchema,
      { status: "" },
      { endpoint: "DELETE /api/v1/documents/{id}/break-glass/{grantId}" },
    ).status === "ok"
  );
}

/** GET /api/v1/documents/{documentID}/admin-summary — metadata-only summary (DOC-05). */
export async function getDocumentAdminSummary(
  documentId: string,
  opts?: { signal?: AbortSignal },
): Promise<DocumentAdminSummary | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/admin-summary`, {
    signal: opts?.signal,
  });
  return parseWithFallback<DocumentAdminSummary | null>(raw, DocumentAdminSummarySchema, null, {
    endpoint: "GET /api/v1/documents/{id}/admin-summary",
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
      fields: isPlainRecord(err.fields) ? err.fields : undefined,
    };
  }
  if (!isPlainRecord(err)) return null;
  const inner = isPlainRecord(err.error) ? err.error : err;
  const code = typeof inner.code === "string" ? inner.code : "";
  if (!code) return null;
  const message = typeof inner.message === "string" ? inner.message : "";
  const status =
    typeof inner.status === "number" ? inner.status : typeof err.status === "number" ? err.status : 0;
  const rawFields = inner.fields ?? err.fields;
  return { code, message, status, fields: isPlainRecord(rawFields) ? rawFields : undefined };
}

/** Parse a failed documents call into a typed DOC-05 error so views can switch on `kind`/`code`. */
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
      const { min: rawMin, max: rawMax, length: rawLength } = extracted.fields ?? {};
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

export function isDocumentRestrictedError(err: unknown): boolean {
  return parseDocumentAccessError(err)?.code === "document_restricted";
}

export function canBreakGlassFromError(err: unknown): boolean {
  const parsed = parseDocumentAccessError(err);
  return parsed?.code === "document_restricted" && parsed.canBreakGlass;
}

export function isBreakGlassRequiredError(err: unknown): boolean {
  return parseDocumentAccessError(err)?.code === "break_glass_required";
}

export function isBreakGlassReasonInvalidError(err: unknown): boolean {
  return parseDocumentAccessError(err)?.code === "break_glass_reason_invalid";
}

