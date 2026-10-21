import { z } from "zod";
import {
  FolderUploadError,
  type FileTarget,
  type FolderUploadBatch,
  type FolderUploadBatchStatus,
  type FolderUploadCompleteItem,
  type FolderUploadCompleteResponse,
  type FolderUploadCounts,
  type FolderUploadFileError,
  type FolderUploadFileStatus,
  type FolderUploadPlanBody,
  type FolderUploadPutOpts,
  type FolderUploadTransport,
  type StoredObject,
} from "../../documents/folder-upload/transport";
import { runtimeConfig } from "../../runtime-config";
import { request, requestWithHeaders, throwFromFailedResponse } from "../http";
import { parseWithFallback } from "../schema";
import { putUploadSessionPart } from "./documents-upload-sessions";

// Folder uploads (UNI-2052, e6-server contract v0.2): one plan call builds
// the folder tree and a batch, the bytes go straight to storage (or through
// the server's content route when storage cannot presign), and complete
// turns stored objects into documents in batches of at most 50.

const enc = encodeURIComponent;

const base = (wsId: string) => `/api/v1/workspaces/${enc(wsId)}/documents/folder-uploads`;

const BATCH_STATUSES: readonly FolderUploadBatchStatus[] = ["open", "completed", "canceled", "expired"];
const FILE_STATUSES: readonly FolderUploadFileStatus[] = ["pending", "done", "failed"];

// An unknown batch status reads as open (the runner asks again), an unknown
// file status as pending: the file is then retried, never counted as done.
const batchStatus = (s: string): FolderUploadBatchStatus => BATCH_STATUSES.find((v) => v === s) ?? "open";
const fileStatus = (s: string): FolderUploadFileStatus => FILE_STATUSES.find((v) => v === s) ?? "pending";

const headersField = z
  .record(z.string(), z.string())
  .optional()
  .catch({})
  .transform((h) => h ?? {});

const PutTargetSchema = z.object({
  kind: z.literal("put"),
  method: z.string().min(1).catch("PUT").optional().default("PUT"),
  url: z.string().min(1),
  headers: headersField,
  expires_at: z.string().catch(""),
  auth: z.string().optional().catch(undefined),
});

const MultipartTargetSchema = z.object({
  kind: z.literal("multipart"),
  session_id: z.string().min(1),
  part_size: z.number().int().positive(),
  parts: z.array(
    z.object({
      part_number: z.number().int().positive(),
      method: z.string().min(1).catch("PUT").optional().default("PUT"),
      url: z.string().min(1),
      headers: headersField,
      expires_at: z.string().catch(""),
    }),
  ),
  expires_at: z.string().catch(""),
});

// A target that does not parse is null: the file is then retried through a
// fresh GET instead of sending bytes to a half-read URL.
const FileTargetSchema = z
  .union([PutTargetSchema, MultipartTargetSchema])
  .nullable()
  .optional()
  .catch(null)
  .transform((t): FileTarget | null => {
    if (!t) return null;
    if (t.kind === "multipart") return t;
    const { auth, ...rest } = t;
    return auth === "session" ? { ...rest, auth: "session" } : rest;
  });

const FileErrorSchema = z
  .object({ code: z.string().min(1), message: z.string().catch(""), reason: z.string().optional().catch(undefined) })
  .nullable()
  .optional()
  .catch(null)
  .transform((e): FolderUploadFileError | null => {
    if (!e) return null;
    return e.reason !== undefined ? e : { code: e.code, message: e.message };
  });

const count = z.number().int().nonnegative().catch(0);
const CountsSchema = z
  .object({ total: count, done: count, failed: count, pending: count })
  .catch({ total: 0, done: 0, failed: 0, pending: 0 });

const BatchFileSchema = z.object({
  file_key: z.string().min(1),
  path: z.string().catch(""),
  filename: z.string().catch(""),
  size_bytes: count,
  status: z.string().catch("pending").transform(fileStatus),
  document_id: z.string().nullable().catch(null),
  error: FileErrorSchema,
  target: FileTargetSchema,
});

/** Drop list entries that do not parse instead of refusing the whole answer. */
function lenientArray<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((raw) => {
        const parsed = item.safeParse(raw);
        return parsed.success ? [parsed.data as z.output<T>] : [];
      }),
    );
}

// Only the id is load-bearing: without it nothing can be completed, so the
// whole answer is refused (null).
const BatchSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().catch("open").transform(batchStatus),
    parent_id: z.string().nullable().catch(null),
    root_folder_id: z.string().catch(""),
    root_title: z.string().catch(""),
    share_with_workspace: z.boolean().catch(false),
    folders: lenientArray(z.object({ path: z.string(), id: z.string().min(1) })),
    files: lenientArray(BatchFileSchema),
    counts: CountsSchema,
    total_bytes: count,
    expires_at: z.string().catch(""),
    created_at: z.string().catch(""),
  })
  .transform((b): FolderUploadBatch => b);

const CompleteSchema = z
  .object({
    results: lenientArray(
      z.object({
        file_key: z.string().min(1),
        status: z.string(),
        document_id: z.string().nullable().catch(null),
        error: FileErrorSchema,
      }),
    ),
    batch: z
      .object({ status: z.string().catch("open").transform(batchStatus), counts: CountsSchema })
      .catch({ status: "open", counts: { total: 0, done: 0, failed: 0, pending: 0 } }),
  })
  .transform(
    (c): FolderUploadCompleteResponse => ({
      // Only "done" with a document counts as done; anything else is a failure
      // the user can retry.
      results: c.results.map((r) =>
        r.status === "done" && r.document_id
          ? { file_key: r.file_key, status: "done", document_id: r.document_id, error: null }
          : {
              file_key: r.file_key,
              status: "failed",
              document_id: null,
              error: r.error ?? { code: "unknown", message: "" },
            },
      ),
      batch: c.batch as { status: FolderUploadBatchStatus; counts: FolderUploadCounts },
    }),
  );

/** POST …/folder-uploads (Idempotency-Key required) → 201 batch; null when it cannot be read. */
export async function createFolderUpload(
  wsId: string,
  body: FolderUploadPlanBody,
  opts: { idempotencyKey: string; signal?: AbortSignal },
): Promise<FolderUploadBatch | null> {
  const raw = await request(base(wsId), {
    method: "POST",
    body,
    headers: { "Idempotency-Key": opts.idempotencyKey },
    signal: opts.signal,
  });
  return parseWithFallback<FolderUploadBatch | null>(raw, BatchSchema, null, {
    endpoint: "POST /api/v1/workspaces/{workspaceID}/documents/folder-uploads",
  });
}

/** GET …/folder-uploads/{batchID} → the batch with fresh targets for pending files. */
export async function getFolderUpload(
  wsId: string,
  batchId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<FolderUploadBatch | null> {
  const raw = await request(`${base(wsId)}/${enc(batchId)}`, { signal: opts.signal });
  return parseWithFallback<FolderUploadBatch | null>(raw, BatchSchema, null, {
    endpoint: "GET /api/v1/workspaces/{workspaceID}/documents/folder-uploads/{batchID}",
  });
}

/** DELETE …/folder-uploads/{batchID} → the canceled batch (idempotent). */
export async function cancelFolderUpload(wsId: string, batchId: string): Promise<FolderUploadBatch | null> {
  const raw = await request(`${base(wsId)}/${enc(batchId)}`, { method: "DELETE" });
  return parseWithFallback<FolderUploadBatch | null>(raw, BatchSchema, null, {
    endpoint: "DELETE /api/v1/workspaces/{workspaceID}/documents/folder-uploads/{batchID}",
  });
}

const EMPTY_COMPLETE: FolderUploadCompleteResponse = {
  results: [],
  batch: { status: "open", counts: { total: 0, done: 0, failed: 0, pending: 0 } },
};

/**
 * POST …/folder-uploads/{batchID}/complete, at most 50 items. A malformed
 * answer reads as no results: those files stay pending and a retry asks the
 * server again (complete is idempotent per file_key).
 */
export async function completeFolderUpload(
  wsId: string,
  batchId: string,
  items: FolderUploadCompleteItem[],
  opts: { signal?: AbortSignal } = {},
): Promise<FolderUploadCompleteResponse> {
  const raw = await request(`${base(wsId)}/${enc(batchId)}/complete`, {
    method: "POST",
    body: { files: items },
    signal: opts.signal,
  });
  return parseWithFallback<FolderUploadCompleteResponse>(raw, CompleteSchema, EMPTY_COMPLETE, {
    endpoint: "POST /api/v1/workspaces/{workspaceID}/documents/folder-uploads/{batchID}/complete",
  });
}

const ContentAnswerSchema = z.object({ etag: z.string().trim().min(1) });

/** Headers a request may not forward: the bearer is the transport's, Host the browser's. */
function forwardable(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    const lower = k.toLowerCase();
    if (lower !== "authorization" && lower !== "host") out[k] = v;
  }
  return out;
}

/** The API path of a content-route URL, or null when it is not under the API origin. */
function apiPathOf(url: string): string | null {
  if (url.startsWith("/")) return url;
  const api = runtimeConfig().apiUrl;
  return api && url.startsWith(`${api}/`) ? url.slice(api.length) : null;
}

/**
 * PUT …/{batchID}/files/{fileKey}/content: the server's own content route
 * (`auth: "session"`, a URL relative to the API origin), with the session
 * bearer. The server sends the same quoted ETag as a header and as `{etag}`;
 * the header wins, the body covers a proxy that hides it.
 */
async function putFolderUploadContent(
  target: Extract<FileTarget, { kind: "put" }>,
  blob: Blob,
  signal?: AbortSignal,
): Promise<string | null> {
  const path = apiPathOf(target.url);
  if (path === null) throw new FolderUploadError("untrusted_target", "Session target outside the API origin");
  const { data, headers } = await requestWithHeaders(path, {
    method: "PUT",
    body: blob,
    headers: forwardable(target.headers),
    signal,
  });
  const header = headers.get("ETag")?.trim();
  if (header) return header;
  const parsed = parseWithFallback<{ etag: string } | null>(data, ContentAnswerSchema, null, {
    endpoint: "PUT /api/v1/workspaces/{workspaceID}/documents/folder-uploads/{batchID}/files/{fileKey}/content",
  });
  return parsed?.etag ?? null;
}

async function putPresigned(
  target: Extract<FileTarget, { kind: "put" }>,
  blob: Blob,
  signal: AbortSignal | undefined,
  doFetch: typeof fetch,
): Promise<string | null> {
  const res = await doFetch(target.url, {
    method: target.method || "PUT",
    headers: forwardable(target.headers),
    // Presigned: the session never travels to storage.
    credentials: "omit",
    body: blob,
    signal,
  });
  if (!res.ok) await throwFromFailedResponse(res);
  return res.headers.get("ETag")?.trim() || null;
}

export interface PutToStorageOpts extends FolderUploadPutOpts {
  /** Injected so tests never reach the network (presigned URLs only). */
  fetch?: typeof fetch;
}

/**
 * Send one file's bytes to its target. Refusals reject as ApiError with the
 * HTTP status; a missing ETag as FolderUploadError("missing_etag"). Parts of
 * a multipart target go one after another (the runner parallelises across
 * files); parts already in `storedParts` are not sent again.
 */
export async function putToStorage(target: FileTarget, blob: Blob, opts: PutToStorageOpts = {}): Promise<StoredObject> {
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  if (target.kind === "put") {
    const etag = target.auth === "session"
      ? await putFolderUploadContent(target, blob, opts.signal)
      : await putPresigned(target, blob, opts.signal, doFetch);
    if (!etag) throw new FolderUploadError("missing_etag", "Storage answered without an ETag");
    return { etag };
  }
  const stored = opts.storedParts ?? new Map<number, string>();
  const urls = new Map(target.parts.map((p) => [p.part_number, p]));
  const partCount = Math.max(1, Math.ceil(blob.size / target.part_size));
  for (let partNumber = 1; partNumber <= partCount; partNumber++) {
    if (stored.has(partNumber) && !urls.has(partNumber)) continue;
    const part = urls.get(partNumber);
    if (!part) throw new FolderUploadError("missing_part_url", `No URL for part ${partNumber}`);
    const start = (partNumber - 1) * target.part_size;
    const etag = await putUploadSessionPart(part.url, blob.slice(start, start + target.part_size), {
      headers: part.headers,
      signal: opts.signal,
      fetch: opts.fetch,
    });
    if (!etag) throw new FolderUploadError("missing_etag", `Storage answered part ${partNumber} without an ETag`);
    stored.set(partNumber, etag);
  }
  const parts = [...stored.entries()]
    .filter(([n]) => n <= partCount)
    .sort(([a], [b]) => a - b)
    .map(([part_number, etag]) => ({ part_number, etag }));
  return { parts };
}

/** Thrown by the HTTP transport when an answer has no usable batch. */
function malformed(what: string): Error {
  return new Error(`Malformed folder-upload ${what} answer`);
}

/** The HTTP FolderUploadTransport for one workspace. */
export function createFolderUploadTransport(wsId: string): FolderUploadTransport {
  return {
    async plan(body, opts) {
      const batch = await createFolderUpload(wsId, body, opts);
      if (!batch) throw malformed("plan");
      return batch;
    },
    put: (target, blob, opts) => putToStorage(target, blob, opts),
    complete: (batchId, items, opts) => completeFolderUpload(wsId, batchId, items, opts),
    async status(batchId, opts) {
      const batch = await getFolderUpload(wsId, batchId, opts);
      if (!batch) throw malformed("status");
      return batch;
    },
    async cancel(batchId) {
      const batch = await cancelFolderUpload(wsId, batchId);
      if (!batch) throw malformed("cancel");
      return batch;
    },
  };
}
