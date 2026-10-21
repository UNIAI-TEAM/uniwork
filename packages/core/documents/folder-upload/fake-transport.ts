import { ApiError } from "../../api/http";
import type {
  FileTarget,
  FolderUploadBatch,
  FolderUploadBatchFile,
  FolderUploadCompleteItem,
  FolderUploadCompleteResponse,
  FolderUploadFileError,
  FolderUploadPlanBody,
  FolderUploadTransport,
  StoredObject,
} from "./transport";

// An in-memory FolderUploadTransport on the v0.2 wire, for runner and views
// tests (and the views' dev fixtures). It keeps one batch the way the server
// would, logs every call, and injects what the server and storage can do
// wrong: per-file complete errors, expired targets, failing PUTs, and
// 4xx/410 answers per method. Latency uses setTimeout, so fake timers drive it.

export type FakeFolderUploadCall =
  | { method: "plan"; body: FolderUploadPlanBody; idempotencyKey: string }
  | { method: "put"; fileKey: string; target: FileTarget }
  | { method: "complete"; batchId: string; items: FolderUploadCompleteItem[] }
  | { method: "status"; batchId: string }
  | { method: "cancel"; batchId: string };

/** What one PUT attempt does instead of storing: a network error, a 5xx, or a 403 refusal. */
export type FakePutFailure = "network" | "5xx" | "403";

export interface FakeFolderUploadOptions {
  /** The server's "(n)" decision; defaults to the plan's root_name. */
  rootTitle?: string;
  /** Delay of every call, PUTs included. */
  latencyMs?: number;
  /** Complete answers these files (by filename) as failed with this error. */
  fileErrors?: Record<string, FolderUploadFileError>;
  /** PUT attempts that fail, in order, by filename; later attempts succeed. */
  putFailures?: Record<string, FakePutFailure[]>;
  /** Filenames whose first target is already past expires_at (storage answers 403). */
  expiredTargets?: string[];
  /** Files above this size get a multipart target. */
  multipartAboveBytes?: number;
  /** Part size of multipart targets (default 8 MiB). */
  partSize?: number;
  /** Put targets are the server's content route (auth "session"). */
  sessionTargets?: boolean;
  /** Errors the next calls of a method throw, in order (e.g. a 429 then nothing). */
  errors?: Partial<Record<"plan" | "complete" | "status" | "cancel", Error[]>>;
}

export interface FakeFolderUploadTransport extends FolderUploadTransport {
  readonly calls: FakeFolderUploadCall[];
  /** The batch as the server holds it now; null before the plan. */
  readonly batch: FolderUploadBatch | null;
  /** Highest number of PUTs in flight at once. */
  readonly peakPuts: number;
  /** Make PUTs wait until the returned release is called (aborts still reject). */
  holdPuts(): () => void;
  /** Queue an error for the next call of a method. */
  failNext(method: "plan" | "complete" | "status" | "cancel", err: Error): void;
}

/** An ApiError shaped like the server's ErrorSDO answer. */
export function folderUploadApiError(
  status: number,
  code: string,
  fields?: Record<string, unknown>,
  retryAfterSeconds?: number,
): ApiError {
  return new ApiError(code, code, status, undefined, fields, undefined, retryAfterSeconds);
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

export function createFakeFolderUploadTransport(options: FakeFolderUploadOptions = {}): FakeFolderUploadTransport {
  const calls: FakeFolderUploadCall[] = [];
  const errors = new Map(Object.entries(options.errors ?? {}).map(([k, v]) => [k, [...v]]));
  const putFailures = new Map(Object.entries(options.putFailures ?? {}).map(([k, v]) => [k, [...v]]));
  const expiredOnce = new Set(options.expiredTargets ?? []);
  const partSize = options.partSize ?? 8 * 1024 * 1024;
  let batch: FolderUploadBatch | null = null;
  let inFlight = 0;
  let peakPuts = 0;
  let signCount = 0;
  let hold: Promise<void> | null = null;
  let stored = new Map<string, StoredObject>();

  const take = (method: string) => {
    const err = errors.get(method)?.shift();
    if (err) throw err;
  };

  function sign(file: FolderUploadBatchFile, expired: boolean): FileTarget {
    signCount += 1;
    const expires_at = new Date(Date.now() + (expired ? -1000 : 3_600_000)).toISOString();
    const url = `https://storage.test/${file.file_key}?sig=${signCount}`;
    if (options.multipartAboveBytes !== undefined && file.size_bytes > options.multipartAboveBytes) {
      const count = Math.max(1, Math.ceil(file.size_bytes / partSize));
      return {
        kind: "multipart",
        session_id: `s-${file.file_key}`,
        part_size: partSize,
        parts: Array.from({ length: count }, (_, i) => ({
          part_number: i + 1,
          method: "PUT",
          url: `${url}&part=${i + 1}`,
          headers: {},
          expires_at,
        })),
        expires_at,
      };
    }
    return options.sessionTargets
      ? {
          kind: "put",
          method: "PUT",
          url: `/api/v1/workspaces/w/documents/folder-uploads/${batch?.id ?? "b"}/files/${file.file_key}/content`,
          headers: {},
          expires_at,
          auth: "session",
        }
      : { kind: "put", method: "PUT", url, headers: { "Content-Type": "application/octet-stream" }, expires_at };
  }

  function recount(b: FolderUploadBatch): void {
    const done = b.files.filter((f) => f.status === "done").length;
    const failed = b.files.filter((f) => f.status === "failed").length;
    b.counts = { total: b.files.length, done, failed, pending: b.files.length - done - failed };
    if (b.status === "open" && b.counts.pending === 0) b.status = "completed";
  }

  const snapshot = (): FolderUploadBatch => structuredClone(batch as FolderUploadBatch);

  function requireBatch(batchId: string): FolderUploadBatch {
    if (!batch || batch.id !== batchId) throw folderUploadApiError(404, "not_found");
    if (batch.status === "expired") throw folderUploadApiError(410, "folder_upload_expired");
    return batch;
  }

  const fileByKey = (key: string) => batch?.files.find((f) => f.file_key === key);

  return {
    calls,
    get batch() {
      return batch;
    },
    get peakPuts() {
      return peakPuts;
    },
    holdPuts() {
      let release = () => {};
      hold = new Promise<void>((resolve) => {
        release = () => {
          hold = null;
          resolve();
        };
      });
      return release;
    },
    failNext(method, err) {
      errors.set(method, [...(errors.get(method) ?? []), err]);
    },

    async plan(body, opts) {
      calls.push({ method: "plan", body: structuredClone(body), idempotencyKey: opts.idempotencyKey });
      await wait(options.latencyMs ?? 0, opts.signal);
      take("plan");
      if (batch) return snapshot();
      stored = new Map();
      const now = Date.now();
      batch = {
        id: "batch-1",
        status: "open",
        parent_id: body.parent_id,
        root_folder_id: "folder-root",
        root_title: options.rootTitle ?? body.root_name,
        share_with_workspace: body.share_with_workspace,
        folders: [{ path: "", id: "folder-root" }, ...body.folders.map((path, i) => ({ path, id: `folder-${i + 1}` }))],
        files: body.files.map((f) => ({
          file_key: f.file_key,
          path: f.path,
          filename: f.filename,
          size_bytes: f.size_bytes,
          status: "pending",
          document_id: null,
          error: null,
          target: null,
        })),
        counts: { total: 0, done: 0, failed: 0, pending: 0 },
        total_bytes: body.files.reduce((sum, f) => sum + f.size_bytes, 0),
        expires_at: new Date(now + 86_400_000).toISOString(),
        created_at: new Date(now).toISOString(),
      };
      for (const f of batch.files) f.target = sign(f, expiredOnce.delete(f.filename));
      recount(batch);
      return snapshot();
    },

    async put(target, blob, opts = {}) {
      const file = batch?.files.find((f) => target.kind === "multipart"
        ? target.session_id === `s-${f.file_key}`
        : target.url.includes(`/${f.file_key}`));
      const fileKey = file?.file_key ?? "?";
      calls.push({ method: "put", fileKey, target });
      inFlight += 1;
      peakPuts = Math.max(peakPuts, inFlight);
      try {
        await wait(options.latencyMs ?? 0, opts.signal);
        if (hold) await Promise.race([hold, wait(Number.MAX_SAFE_INTEGER, opts.signal)]);
        if (opts.signal?.aborted) throw abortError();
        const failure = file ? putFailures.get(file.filename)?.shift() : undefined;
        if (failure === "network") throw new TypeError("Failed to fetch");
        if (failure === "5xx") throw folderUploadApiError(503, "internal");
        if (failure === "403" || Date.parse(target.expires_at) <= Date.now()) {
          throw folderUploadApiError(403, "internal");
        }
        let result: StoredObject;
        if (target.kind === "put") {
          result = { etag: `"etag-${fileKey}"` };
        } else {
          for (const p of target.parts) opts.storedParts?.set(p.part_number, `"etag-${fileKey}-${p.part_number}"`);
          const count = Math.max(1, Math.ceil(blob.size / target.part_size));
          result = {
            parts: Array.from({ length: count }, (_, i) => ({ part_number: i + 1, etag: `"etag-${fileKey}-${i + 1}"` })),
          };
        }
        stored.set(fileKey, result);
        return result;
      } finally {
        inFlight -= 1;
      }
    },

    async complete(batchId, items, opts = {}) {
      calls.push({ method: "complete", batchId, items: structuredClone(items) });
      await wait(options.latencyMs ?? 0, opts.signal);
      take("complete");
      const b = requireBatch(batchId);
      if (b.status === "canceled") throw folderUploadApiError(409, "folder_upload_canceled");
      if (items.length > 50) throw folderUploadApiError(400, "invalid_request", { max: 50 });
      const results: FolderUploadCompleteResponse["results"] = items.map((item) => {
        const file = fileByKey(item.file_key);
        if (!file) {
          return { file_key: item.file_key, status: "failed", document_id: null, error: { code: "not_found", message: "" } };
        }
        if (file.status === "pending") {
          const injected = options.fileErrors?.[file.filename];
          if (!stored.has(file.file_key)) {
            file.status = "failed";
            file.error = { code: "upload_missing", message: "" };
          } else if (injected) {
            file.status = "failed";
            file.error = injected;
          } else {
            file.status = "done";
            file.document_id = `doc-${file.file_key}`;
          }
          file.target = null;
        }
        return { file_key: file.file_key, status: file.status === "done" ? "done" : "failed", document_id: file.document_id, error: file.error };
      });
      recount(b);
      return { results, batch: { status: b.status, counts: { ...b.counts } } };
    },

    async status(batchId, opts = {}) {
      calls.push({ method: "status", batchId });
      await wait(options.latencyMs ?? 0, opts.signal);
      take("status");
      const b = requireBatch(batchId);
      for (const f of b.files) f.target = f.status === "pending" && b.status === "open" ? sign(f, false) : null;
      return snapshot();
    },

    async cancel(batchId) {
      calls.push({ method: "cancel", batchId });
      await wait(options.latencyMs ?? 0);
      take("cancel");
      const b = requireBatch(batchId);
      if (b.status === "open") b.status = "canceled";
      for (const f of b.files) f.target = null;
      return snapshot();
    },
  };
}
