import { z } from "zod";
import { ApiError, request, type RequestOpts } from "../http";
import { parseWithFallback } from "../schema";
import { runtimeConfig } from "../../runtime-config";

// Office Docs web frame (UNI-1013). The host page mints a frame token with its
// session (`mintOfficeFrameToken`) and hands it to the genoffice Docs frame in
// the postMessage init. Every /api/v1/office-frame/* route takes only that
// token as Bearer — never the session token or a cookie — and opens only the
// one document it was minted for. `createOfficeFrameClient` is the frame-side
// caller, kept here so both sides parse the same schemas.

const enc = encodeURIComponent;
const id = z.string().min(1).max(128);
const rfc3339 = z.string().min(1);

export const officeFrameTokenSchema = z.object({
  token: z.string().min(1),
  token_type: z.string(),
  expires_at: rfc3339,
  expires_in: z.number().int().nonnegative(),
  document_id: id,
  workspace_id: id,
  organization_id: id,
  can_edit: z.boolean(),
});

const officeFrameFileSchema = z.object({
  file_id: z.string(),
  version_id: z.string(),
  version: z.number().int(),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
  checksum_sha256: z.string(),
});

export const officeFrameDocumentSchema = z.object({
  document_id: id,
  workspace_id: id,
  organization_id: id,
  title: z.string(),
  revision: z.string().min(1),
  can_edit: z.boolean(),
  file: officeFrameFileSchema,
  download_url: z.string().min(1),
  updated_at: z.string().optional(),
});

export const officeFrameUploadSchema = z.object({
  upload_id: id,
  checksum_sha256: z.string(),
  size_bytes: z.number(),
  claim_expires_at: z.string(),
});

export const officeFrameRecentsSchema = z.object({
  items: z.array(z.object({
    document_id: id,
    title: z.string(),
    updated_at: z.string().optional(),
  })),
});

const officeFrameAssetUrlSchema = z.object({
  asset_id: id,
  url: z.string().min(1),
  expires_at: rfc3339,
});

export const officeFrameAssetSchema = z.object({
  asset_id: id,
  document_id: id,
  mime_type: z.string(),
  size_bytes: z.number(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  url: z.string().min(1),
  expires_at: rfc3339,
});

export const officeFrameAssetUrlsSchema = z.object({ items: z.array(officeFrameAssetUrlSchema) });

export type OfficeFrameToken = z.infer<typeof officeFrameTokenSchema>;
export type OfficeFrameDocument = z.infer<typeof officeFrameDocumentSchema>;
export type OfficeFrameUpload = z.infer<typeof officeFrameUploadSchema>;
export type OfficeFrameRecents = z.infer<typeof officeFrameRecentsSchema>;
export type OfficeFrameAsset = z.infer<typeof officeFrameAssetSchema>;
export type OfficeFrameAssetUrls = z.infer<typeof officeFrameAssetUrlsSchema>;

/** POST /api/v1/documents/{documentID}/office/frame-token — host session only.
 *  Null when the answer does not match the contract. */
export async function mintOfficeFrameToken(
  documentId: string,
  opts?: Pick<RequestOpts, "signal" | "correlationId">,
): Promise<OfficeFrameToken | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/office/frame-token`, {
    method: "POST",
    signal: opts?.signal,
    correlationId: opts?.correlationId,
  });
  return parseWithFallback<OfficeFrameToken | null>(raw, officeFrameTokenSchema, null, {
    endpoint: "POST /api/v1/documents/{documentID}/office/frame-token",
  });
}

export interface OfficeFrameClientOptions {
  /** The current frame token; read on every call so a refresh takes effect. */
  getToken: () => string;
  /** API origin; defaults to the runtime config (same origin in the web host). */
  apiUrl?: string;
  /** Injected for tests and non-DOM runtimes. */
  fetch?: typeof fetch;
}

export interface OfficeFrameClient {
  refresh(): Promise<OfficeFrameToken | null>;
  open(documentId: string): Promise<OfficeFrameDocument | null>;
  /** Bytes of `download_url` (an /api/v1/office-frame path). */
  content(downloadUrl: string, signal?: AbortSignal): Promise<Blob>;
  upload(documentId: string, file: Blob, filename: string, idempotencyKey?: string): Promise<OfficeFrameUpload | null>;
  /** Save. A stale base rejects with ApiError status 409 code document_version_conflict. */
  commit(documentId: string, body: { upload_id: string; base_revision: string }, idempotencyKey?: string): Promise<OfficeFrameDocument | null>;
  recents(documentId: string, limit?: number): Promise<OfficeFrameRecents>;
  uploadAsset(documentId: string, file: Blob, filename: string, idempotencyKey?: string): Promise<OfficeFrameAsset | null>;
  signAssets(documentId: string, assetIds: string[]): Promise<OfficeFrameAssetUrls>;
  /**
   * PDF of the live bytes (`file`, the editor's unsaved docx) or of a stored
   * `version` (default: current). Null when a 200 is not a PDF. 501
   * unsupported_operation (no renderer), 504 and 413 reject as ApiError.
   */
  exportPdf(documentId: string, input: OfficeFramePdfInput, idempotencyKey?: string): Promise<ArrayBuffer | null>;
}

export interface OfficeFramePdfInput {
  file?: Blob;
  version?: number;
  signal?: AbortSignal;
}

/** A PDF answer is the declared type AND the bytes ("%PDF-"); anything else is drift. */
const officeFramePdfSchema = z.object({
  content_type: z.string().regex(/^application\/pdf\b/i),
  magic: z.literal("%PDF-"),
});

/** The frame-side caller: Bearer frame token, no cookies, contract-checked. */
export function createOfficeFrameClient(options: OfficeFrameClientOptions): OfficeFrameClient {
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const base = () => options.apiUrl ?? runtimeConfig().apiUrl;

  async function send(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${options.getToken()}` };
    if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
    if (typeof init.body === "string") headers["Content-Type"] = "application/json";
    const res = await doFetch(base() + path, { method: init.method ?? "GET", body: init.body, signal: init.signal, headers, credentials: "omit" });
    if (!res.ok) {
      let code = "internal";
      let message = res.statusText;
      let fields: Record<string, unknown> | undefined;
      try {
        const body = (await res.json()) as { error?: { code?: unknown; message?: unknown; fields?: unknown } };
        if (typeof body.error?.code === "string") code = body.error.code;
        if (typeof body.error?.message === "string") message = body.error.message;
        if (body.error?.fields && typeof body.error.fields === "object" && !Array.isArray(body.error.fields)) {
          fields = body.error.fields as Record<string, unknown>;
        }
      } catch {
        /* body is not JSON */
      }
      throw new ApiError(message, code, res.status, undefined, fields);
    }
    return res;
  }

  async function json(path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<unknown> {
    const res = await send(path, init);
    try {
      return (await res.json()) as unknown;
    } catch {
      return undefined;
    }
  }

  const docPath = (documentId: string) => `/api/v1/office-frame/documents/${enc(documentId)}`;
  const form = (file: Blob, filename: string) => {
    const body = new FormData();
    body.append("file", file, filename);
    return body;
  };

  return {
    async refresh() {
      return parseWithFallback<OfficeFrameToken | null>(await json("/api/v1/office-frame/token", { method: "POST" }), officeFrameTokenSchema, null, { endpoint: "POST /api/v1/office-frame/token" });
    },
    async open(documentId) {
      return parseWithFallback<OfficeFrameDocument | null>(await json(docPath(documentId)), officeFrameDocumentSchema, null, { endpoint: "GET /api/v1/office-frame/documents/{documentID}" });
    },
    async content(downloadUrl, signal) {
      if (!downloadUrl.startsWith("/api/v1/office-frame/documents/")) {
        throw new ApiError("download_url is not a frame route", "invalid_request", 400);
      }
      return (await send(downloadUrl, { signal })).blob();
    },
    async upload(documentId, file, filename, idempotencyKey) {
      const raw = await json(`${docPath(documentId)}/uploads`, { method: "POST", body: form(file, filename), idempotencyKey });
      return parseWithFallback<OfficeFrameUpload | null>(raw, officeFrameUploadSchema, null, { endpoint: "POST /api/v1/office-frame/documents/{documentID}/uploads" });
    },
    async commit(documentId, body, idempotencyKey) {
      const raw = await json(`${docPath(documentId)}/versions/commit`, { method: "POST", body: JSON.stringify(body), idempotencyKey });
      return parseWithFallback<OfficeFrameDocument | null>(raw, officeFrameDocumentSchema, null, { endpoint: "POST /api/v1/office-frame/documents/{documentID}/versions/commit" });
    },
    async recents(documentId, limit) {
      const query = limit ? `?limit=${limit}` : "";
      return parseWithFallback<OfficeFrameRecents>(await json(`${docPath(documentId)}/recents${query}`), officeFrameRecentsSchema, { items: [] }, { endpoint: "GET /api/v1/office-frame/documents/{documentID}/recents" });
    },
    async uploadAsset(documentId, file, filename, idempotencyKey) {
      const raw = await json(`${docPath(documentId)}/assets`, { method: "POST", body: form(file, filename), idempotencyKey });
      return parseWithFallback<OfficeFrameAsset | null>(raw, officeFrameAssetSchema, null, { endpoint: "POST /api/v1/office-frame/documents/{documentID}/assets" });
    },
    async exportPdf(documentId, input, idempotencyKey) {
      const body = new FormData();
      if (input.file) body.append("file", input.file, "document.docx");
      else if (input.version !== undefined) body.append("version", String(input.version));
      const res = await send(`${docPath(documentId)}/export/pdf`, { method: "POST", body, idempotencyKey, signal: input.signal });
      const bytes = await res.arrayBuffer();
      const answer = {
        content_type: res.headers.get("Content-Type") ?? "",
        magic: String.fromCharCode(...new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength))),
      };
      const pdf = parseWithFallback(answer, officeFramePdfSchema, null, { endpoint: "POST /api/v1/office-frame/documents/{documentID}/export/pdf" });
      return pdf ? bytes : null;
    },
    async signAssets(documentId, assetIds) {
      const raw = await json(`${docPath(documentId)}/assets/sign`, { method: "POST", body: JSON.stringify({ asset_ids: assetIds }) });
      return parseWithFallback<OfficeFrameAssetUrls>(raw, officeFrameAssetUrlsSchema, { items: [] }, { endpoint: "POST /api/v1/office-frame/documents/{documentID}/assets/sign" });
    },
  };
}
