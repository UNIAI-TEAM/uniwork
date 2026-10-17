import { z } from "zod";
import { runtimeConfig } from "../../runtime-config";
import {
  DocumentEnvelopeSchema,
  DocumentUploadSchema,
  type Document,
  type DocumentUpload,
} from "../../types/document";
import { request, throwFromFailedResponse } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

export const UPLOAD_SESSION_STATUSES = ["open", "validating", "completed"] as const;
export type UploadSessionStatus = (typeof UPLOAD_SESSION_STATUSES)[number];

export interface UploadSessionProbe {
  head_b64: string;
  central_dir_b64: string;
  cd_offset: number;
  cd_size: number;
}

export interface CreateWorkspaceUploadSessionBody {
  filename: string;
  size_bytes: number;
  parent_id?: string | null;
  title?: string;
  visibility?: string | null;
  probe: UploadSessionProbe;
}

export interface CreateDocumentUploadSessionBody {
  filename: string;
  size_bytes: number;
  probe: UploadSessionProbe;
}

export interface UploadSessionCompletedPart {
  part_number: number;
  etag: string;
  size: number;
}

export interface UploadSessionPartURL {
  part_number: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  expires_at: string;
}

export const UploadSessionCompletedPartSchema = z.object({
  part_number: z.number().int().positive(),
  etag: z.string().min(1),
  size: z.number().int().nonnegative().optional().default(0),
});

export const UploadSessionPartURLSchema = z.object({
  part_number: z.number().int().positive(),
  method: z.string().optional().default("PUT"),
  url: z.string().min(1),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .catch({})
    .transform((h) => h ?? {}),
  expires_at: z.string().min(1),
});

function asUploadSessionStatus(value: string | undefined): UploadSessionStatus | undefined {
  return UPLOAD_SESSION_STATUSES.find((s) => s === value);
}

export interface UploadSession {
  session_id: string;
  status?: UploadSessionStatus;
  part_size: number;
  total_parts: number;
  completed_parts: UploadSessionCompletedPart[];
  parts: UploadSessionPartURL[];
  expires_at: string;
}

export const UploadSessionSchema = z
  .object({
    session_id: z.string().min(1),
    status: z.string().optional(),
    part_size: z.number().int().positive(),
    total_parts: z.number().int().positive(),
    completed_parts: z.array(UploadSessionCompletedPartSchema).optional().default([]),
    parts: z.array(UploadSessionPartURLSchema).optional().default([]),
    expires_at: z.string().min(1),
  })
  .transform((v): UploadSession => {
    const status = asUploadSessionStatus(v.status);
    const { status: _rawStatus, ...rest } = v;
    return status !== undefined ? { ...rest, status } : rest;
  });

export interface UploadSessionCompletePart {
  part_number: number;
  etag: string;
}

export interface CompleteUploadSessionBody {
  parts: UploadSessionCompletePart[];
}

export type UploadSessionCompleteResponse =
  | { kind: "document"; document: Document }
  | { kind: "upload"; upload: DocumentUpload };

export const UploadSessionCompleteSchema = z.union([
  DocumentEnvelopeSchema.transform((v): UploadSessionCompleteResponse => ({
    kind: "document",
    document: v.document as Document,
  })),
  DocumentUploadSchema.transform((v): UploadSessionCompleteResponse => ({
    kind: "upload",
    upload: v,
  })),
]);

const PartETagSchema = z.object({
  etag: z.string().trim().min(1),
});

export interface UploadSessionRequestOpts {
  signal?: AbortSignal;
}

export interface UploadSessionCreateOpts extends UploadSessionRequestOpts {
  idempotencyKey: string;
}

export interface FrameUploadSessionRequestOpts extends UploadSessionRequestOpts {
  frameToken: string;
  fetch?: typeof fetch;
  apiUrl?: string;
}

export interface FrameUploadSessionCreateOpts extends FrameUploadSessionRequestOpts {
  idempotencyKey: string;
}

export interface UploadSessionPartPutOpts {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /**
   * Bytes of the request body the transport has already handed to the network,
   * from the request's own upload events. The engine adds them to the finished
   * parts, so the bar moves while the first 8 MiB part is still going (V-1).
   * Only the XMLHttpRequest path reports: an injected `fetch` cannot see
   * upload progress.
   */
  onProgress?: (loaded: number) => void;
}

/** `getAllResponseHeaders()` as a header map (its value is a CRLF-separated raw string). */
function headersFromRaw(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return out;
}

/**
 * The part PUT over XMLHttpRequest — the only transport that reports upload
 * bytes (V-1). It keeps the fetch path's contract: `withCredentials` off, no
 * Authorization header, the ETag read from the response, and the same
 * ApiError mapping through `throwFromFailedResponse` on a synthetic Response,
 * so both transports fail identically.
 */
function partPutXhr(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  opts?: UploadSessionPartPutOpts,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = false;
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    const onAbort = () => xhr.abort();
    const cleanup = () => opts?.signal?.removeEventListener("abort", onAbort);
    opts?.signal?.addEventListener("abort", onAbort, { once: true });
    const onProgress = opts?.onProgress;
    // A runtime may expose XMLHttpRequest without the upload side; the request
    // then just runs without progress, like the fetch path.
    if (onProgress && xhr.upload) {
      xhr.upload.addEventListener("progress", (event) => onProgress(event.loaded));
    }
    xhr.addEventListener("load", () => {
      cleanup();
      try {
        // 204/205/304 may not carry a body; a status of 0 (a blocked request)
        // makes the Response constructor throw, which is the network error.
        const noBody = xhr.status === 204 || xhr.status === 205 || xhr.status === 304;
        resolve(
          new Response(noBody ? null : xhr.responseText, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: headersFromRaw(xhr.getAllResponseHeaders()),
          }),
        );
      } catch {
        reject(new TypeError("Failed to fetch"));
      }
    });
    // fetch rejects a network failure with TypeError and an abort with
    // DOMException("AbortError"); the retry logic depends on that shape.
    xhr.addEventListener("error", () => {
      cleanup();
      reject(new TypeError("Failed to fetch"));
    });
    xhr.addEventListener("timeout", () => {
      cleanup();
      reject(new TypeError("Failed to fetch"));
    });
    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    });
    if (opts?.signal?.aborted) {
      // `abort()` before `send()` fires nothing, so settle directly.
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    xhr.send(body);
  });
}

async function frameRequest(
  path: string,
  init: {
    method: "GET" | "POST" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    opts: FrameUploadSessionRequestOpts;
  },
): Promise<unknown> {
  const doFetch =
    init.opts.fetch ?? ((input: RequestInfo | URL, reqInit?: RequestInit) => fetch(input, reqInit));
  const base = init.opts.apiUrl ?? runtimeConfig().apiUrl;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.opts.frameToken}`,
    ...init.headers,
  };
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await doFetch(base + path, {
    method: init.method,
    headers,
    credentials: "omit",
    body,
    signal: init.opts.signal,
  });
  if (!res.ok) await throwFromFailedResponse(res);
  if (res.status === 204) return undefined;
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}

export async function createWorkspaceUploadSession(
  wsId: string,
  body: CreateWorkspaceUploadSessionBody,
  opts: UploadSessionCreateOpts,
): Promise<UploadSession | null> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/upload-sessions`, {
    method: "POST",
    body,
    headers: { "Idempotency-Key": opts.idempotencyKey },
    signal: opts.signal,
  });
  return parseWithFallback<UploadSession | null>(raw, UploadSessionSchema, null, {
    endpoint: "POST /api/v1/workspaces/{workspaceID}/documents/upload-sessions",
  });
}

export async function createDocumentUploadSession(
  documentId: string,
  body: CreateDocumentUploadSessionBody,
  opts: UploadSessionCreateOpts,
): Promise<UploadSession | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/upload-sessions`, {
    method: "POST",
    body,
    headers: { "Idempotency-Key": opts.idempotencyKey },
    signal: opts.signal,
  });
  return parseWithFallback<UploadSession | null>(raw, UploadSessionSchema, null, {
    endpoint: "POST /api/v1/documents/{documentID}/upload-sessions",
  });
}

export async function createFrameUploadSession(
  documentId: string,
  body: CreateDocumentUploadSessionBody,
  opts: FrameUploadSessionCreateOpts,
): Promise<UploadSession | null> {
  const raw = await frameRequest(
    `/api/v1/office-frame/documents/${enc(documentId)}/upload-sessions`,
    {
      method: "POST",
      body,
      headers: { "Idempotency-Key": opts.idempotencyKey },
      opts,
    },
  );
  return parseWithFallback<UploadSession | null>(raw, UploadSessionSchema, null, {
    endpoint: "POST /api/v1/office-frame/documents/{documentID}/upload-sessions",
  });
}

export async function getUploadSession(
  sessionId: string,
  opts?: UploadSessionRequestOpts,
): Promise<UploadSession | null> {
  const raw = await request(`/api/v1/upload-sessions/${enc(sessionId)}`, {
    method: "GET",
    signal: opts?.signal,
  });
  return parseWithFallback<UploadSession | null>(raw, UploadSessionSchema, null, {
    endpoint: "GET /api/v1/upload-sessions/{sessionID}",
  });
}

export async function getFrameUploadSession(
  documentId: string,
  sessionId: string,
  opts: FrameUploadSessionRequestOpts,
): Promise<UploadSession | null> {
  const raw = await frameRequest(
    `/api/v1/office-frame/documents/${enc(documentId)}/upload-sessions/${enc(sessionId)}`,
    {
      method: "GET",
      opts,
    },
  );
  return parseWithFallback<UploadSession | null>(raw, UploadSessionSchema, null, {
    endpoint: "GET /api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}",
  });
}

export async function completeUploadSession(
  sessionId: string,
  body: CompleteUploadSessionBody,
  opts?: UploadSessionRequestOpts,
): Promise<UploadSessionCompleteResponse | null> {
  const raw = await request(`/api/v1/upload-sessions/${enc(sessionId)}/complete`, {
    method: "POST",
    body,
    signal: opts?.signal,
  });
  return parseWithFallback<UploadSessionCompleteResponse | null>(
    raw,
    UploadSessionCompleteSchema,
    null,
    { endpoint: "POST /api/v1/upload-sessions/{sessionID}/complete" },
  );
}

export async function completeFrameUploadSession(
  documentId: string,
  sessionId: string,
  body: CompleteUploadSessionBody,
  opts: FrameUploadSessionRequestOpts,
): Promise<DocumentUpload | null> {
  const raw = await frameRequest(
    `/api/v1/office-frame/documents/${enc(documentId)}/upload-sessions/${enc(sessionId)}/complete`,
    {
      method: "POST",
      body,
      opts,
    },
  );
  return parseWithFallback<DocumentUpload | null>(raw, DocumentUploadSchema, null, {
    endpoint: "POST /api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}/complete",
  });
}

export async function abortUploadSession(
  sessionId: string,
  opts?: UploadSessionRequestOpts,
): Promise<void> {
  const raw = await request(`/api/v1/upload-sessions/${enc(sessionId)}`, {
    method: "DELETE",
    signal: opts?.signal,
  });
  parseWithFallback(raw, z.undefined(), undefined, {
    endpoint: "DELETE /api/v1/upload-sessions/{sessionID}",
  });
}

export async function abortFrameUploadSession(
  documentId: string,
  sessionId: string,
  opts: FrameUploadSessionRequestOpts,
): Promise<void> {
  const raw = await frameRequest(
    `/api/v1/office-frame/documents/${enc(documentId)}/upload-sessions/${enc(sessionId)}`,
    {
      method: "DELETE",
      opts,
    },
  );
  parseWithFallback(raw, z.undefined(), undefined, {
    endpoint: "DELETE /api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}",
  });
}

export async function putUploadSessionPart(
  url: string,
  body: Blob,
  opts?: UploadSessionPartPutOpts,
): Promise<string | null> {
  const headers: Record<string, string> = {};
  if (opts?.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      // Host is a forbidden request header: the AWS presigner signs it, but a
      // browser sets it itself and xhr.setRequestHeader logs a refusal per part.
      const lower = k.toLowerCase();
      if (lower !== "authorization" && lower !== "host") {
        headers[k] = v;
      }
    }
  }
  // A browser can only observe how many bytes of a request body have left the
  // machine through XMLHttpRequest; `fetch` reports nothing until the response,
  // which for an 8 MiB part means the bar sits still for seconds (V-1). Only
  // when a caller wants those bytes: the fetch path stays for an injected
  // transport (tests, a host that re-routes the origin), for runtimes without
  // XHR, and for every call that does not ask for progress.
  const res =
    opts?.onProgress && !opts.fetch && typeof XMLHttpRequest !== "undefined"
      ? await partPutXhr(url, body, headers, opts)
      : await (opts?.fetch ?? fetch)(url, {
          method: "PUT",
          headers,
          credentials: "omit",
          body,
          signal: opts?.signal,
        });
  if (!res.ok) await throwFromFailedResponse(res);
  const rawEtag = res.headers.get("ETag") ?? res.headers.get("etag") ?? "";
  const parsed = parseWithFallback<{ etag: string } | null>(
    { etag: rawEtag },
    PartETagSchema,
    null,
    { endpoint: "PUT upload-session-part" },
  );
  return parsed?.etag ?? null;
}
