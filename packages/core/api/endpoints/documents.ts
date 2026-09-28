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
import { request, requestBlob } from "../http";
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
}

export interface CreateDocumentBody {
  title: string;
  /** Only "page" is valid on this route; a file document is created through
   *  createDocumentFile on the multipart route. */
  kind?: "page";
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

function fileForm(file: Blob, fields?: Record<string, string | undefined>): FormData {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value !== undefined) form.set(key, value);
  }
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
 */
export async function uploadDocumentFile(
  documentId: string,
  file: Blob,
  opts?: DocumentRequestOpts,
): Promise<DocumentUpload | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/uploads`, {
    method: "POST",
    body: fileForm(file),
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
