import {
  abortFrameUploadSession,
  abortUploadSession,
  completeFrameUploadSession,
  completeUploadSession,
  createDocumentUploadSession,
  createFrameUploadSession,
  createWorkspaceUploadSession,
  getFrameUploadSession,
  getUploadSession,
  putUploadSessionPart,
  type UploadSession,
  type UploadSessionPartURL,
} from "../../api/endpoints/documents-upload-sessions";
import { ApiError } from "../../api/http";
import type { Document, DocumentUpload } from "../../types/document";
import type { StorageAdapter } from "../../types/storage";
import { buildUploadProbe, ChunkedUploadError } from "./probe";
import {
  clearResumableUpload,
  findResumableUpload,
  saveResumableUpload,
  uploadFileKey,
} from "./resume";
import type { UploadSessionTarget } from "./target";

export type ChunkedUploadPhase =
  | "probing"
  | "opening"
  | "uploading"
  | "paused"
  | "verifying"
  | "done"
  | "failed"
  | "canceled";

export interface ChunkedUploadProgress {
  phase: ChunkedUploadPhase;
  sentBytes: number;
  totalBytes: number;
  sessionId?: string;
}

export interface ChunkedUploadOptions {
  file: File | Blob;
  filename: string;
  target: UploadSessionTarget;
  /** Stable per (file key, target); the engine derives part keys from it. */
  idempotencyKey: string;
  /** Resume record; default none. */
  storage?: StorageAdapter;
  onProgress?: (p: ChunkedUploadProgress) => void;
  /** Default 4. */
  concurrency?: number;
  /** Default [1000, 2000, 4000]. */
  retryDelaysMs?: number[];
  /** Injected for tests. */
  fetch?: typeof fetch;
}

export type ChunkedUploadResult =
  | { kind: "document"; document: Document }
  | { kind: "upload"; upload: DocumentUpload };

export interface ChunkedUpload {
  /** Resolves with the complete answer: DocumentSDO (workspace) or DocumentUploadSDO (version, frame). Rejects with ApiError (server codes as today) or ChunkedUploadError. */
  result: Promise<ChunkedUploadResult>;
  /** Aborts in-flight part PUTs, keeps the session and the resume record. */
  pause(): void;
  /** GET the session, refresh URLs, send the missing parts. */
  resume(): void;
  /** DELETE the session, clear the resume record. */
  cancel(): Promise<void>;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

function isClearedSessionError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 404 || err.status === 410 || err.code === "upload_session_expired")
  );
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function startChunkedUpload(opts: ChunkedUploadOptions): ChunkedUpload {
  const totalBytes = opts.file.size;
  const fileKey = uploadFileKey(opts.file, opts.filename);
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  let sessionId: string | undefined;
  let partSize = 0;
  let totalParts = 0;
  let maxSentBytes = 0;
  const completedEtags = new Map<number, string>();
  const partUrls = new Map<number, UploadSessionPartURL>();

  let currentPhase: ChunkedUploadPhase = "probing";
  let paused = false;
  let canceled = false;
  let pauseGeneration = 0;
  let needsRefreshBeforeUpload = false;
  let pauseWaiters: (() => void)[] = [];
  let inFlightAbort = new AbortController();
  let refreshPromise: Promise<void> | null = null;

  function partByteLength(partNumber: number): number {
    if (totalParts <= 0 || partSize <= 0) return 0;
    const start = (partNumber - 1) * partSize;
    return Math.max(0, Math.min(totalBytes, start + partSize) - start);
  }

  function computeSentBytes(): number {
    let sum = 0;
    for (const partNumber of completedEtags.keys()) sum += partByteLength(partNumber);
    maxSentBytes = Math.max(maxSentBytes, Math.min(totalBytes, sum));
    return maxSentBytes;
  }

  function emit(phase: ChunkedUploadPhase): void {
    currentPhase = phase;
    const sentBytes = phase === "done" ? totalBytes : computeSentBytes();
    opts.onProgress?.({
      phase,
      sentBytes,
      totalBytes,
      ...(sessionId ? { sessionId } : {}),
    });
  }

  function applySessionSnapshot(session: UploadSession): void {
    sessionId = session.session_id;
    partSize = session.part_size;
    totalParts = session.total_parts;
    for (const cp of session.completed_parts) completedEtags.set(cp.part_number, cp.etag);
    for (const p of session.parts) partUrls.set(p.part_number, p);
    if (opts.storage) {
      saveResumableUpload(opts.storage, fileKey, opts.target, {
        session_id: session.session_id,
        expires_at: session.expires_at,
        idempotency_key: opts.idempotencyKey,
      });
    }
  }

  async function waitWhilePaused(): Promise<void> {
    while (paused && !canceled) {
      await new Promise<void>((resolve) => {
        pauseWaiters.push(resolve);
      });
    }
    if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
  }

  async function fetchSessionStatus(id: string): Promise<UploadSession | null> {
    if (opts.target.kind === "frame") {
      return getFrameUploadSession(opts.target.documentId, id, {
        frameToken: opts.target.frameToken,
        fetch: opts.fetch,
        signal: inFlightAbort.signal,
      });
    }
    return getUploadSession(id, { fetch: opts.fetch, signal: inFlightAbort.signal });
  }

  async function refreshSession(): Promise<void> {
    if (!sessionId) return;
    if (refreshPromise) return refreshPromise;
    const id = sessionId;
    refreshPromise = (async () => {
      try {
        const fresh = await fetchSessionStatus(id);
        if (!fresh) {
          throw new ChunkedUploadError("malformed_response", "Malformed upload session status");
        }
        applySessionSnapshot(fresh);
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function openOrResumeSession(): Promise<void> {
    emit("probing");
    const probe = await buildUploadProbe(opts.file);
    if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
    await waitWhilePaused();

    emit("opening");
    if (opts.storage) {
      const saved = findResumableUpload(opts.storage, fileKey, opts.target);
      if (saved) {
        try {
          const existing = await fetchSessionStatus(saved.session_id);
          if (existing && existing.status !== "completed") {
            applySessionSnapshot(existing);
            return;
          }
          clearResumableUpload(opts.storage, fileKey, opts.target);
        } catch (err) {
          if (isClearedSessionError(err)) {
            clearResumableUpload(opts.storage, fileKey, opts.target);
          } else {
            throw err;
          }
        }
      }
    }

    const reqOpts = {
      idempotencyKey: opts.idempotencyKey,
      fetch: opts.fetch,
      signal: inFlightAbort.signal,
    };
    let created: UploadSession | null = null;
    if (opts.target.kind === "workspace") {
      created = await createWorkspaceUploadSession(
        opts.target.workspaceId,
        {
          filename: opts.filename,
          size_bytes: totalBytes,
          parent_id: opts.target.parentId,
          title: opts.target.title,
          visibility: opts.target.visibility,
          probe,
        },
        reqOpts,
      );
    } else if (opts.target.kind === "version") {
      created = await createDocumentUploadSession(
        opts.target.documentId,
        { filename: opts.filename, size_bytes: totalBytes, probe },
        reqOpts,
      );
    } else {
      created = await createFrameUploadSession(
        opts.target.documentId,
        { filename: opts.filename, size_bytes: totalBytes, probe },
        { ...reqOpts, frameToken: opts.target.frameToken },
      );
    }

    if (!created) {
      throw new ChunkedUploadError("malformed_response", "Malformed create upload session response");
    }
    applySessionSnapshot(created);
  }

  async function uploadSinglePart(
    partNumber: number,
    gen: number,
    signal: AbortSignal,
  ): Promise<void> {
    let attempt = 0;
    while (!completedEtags.has(partNumber)) {
      if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
      if (paused || pauseGeneration !== gen || signal.aborted) return;

      let partMeta = partUrls.get(partNumber);
      const expired =
        !partMeta ||
        (Number.isFinite(Date.parse(partMeta.expires_at)) &&
          Date.parse(partMeta.expires_at) <= Date.now());
      if (expired) {
        await refreshSession();
        if (completedEtags.has(partNumber)) {
          emit("uploading");
          return;
        }
        partMeta = partUrls.get(partNumber);
      }
      if (!partMeta) {
        throw new ChunkedUploadError("malformed_response", `Missing URL for part ${partNumber}`);
      }

      const start = (partNumber - 1) * partSize;
      const chunk = opts.file.slice(start, Math.min(totalBytes, start + partSize));

      try {
        const etag = await putUploadSessionPart(partMeta.url, chunk, {
          headers: partMeta.headers,
          signal,
          fetch: opts.fetch,
        });
        if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
        if (paused || pauseGeneration !== gen || signal.aborted) return;
        if (!etag) {
          throw new ChunkedUploadError("missing_etag", `Missing ETag on part ${partNumber}`);
        }
        completedEtags.set(partNumber, etag);
        emit("uploading");
        return;
      } catch (err) {
        if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
        if (paused || pauseGeneration !== gen || signal.aborted) return;
        if (isClearedSessionError(err)) {
          if (opts.storage) clearResumableUpload(opts.storage, fileKey, opts.target);
          throw err;
        }
        if (attempt >= retryDelays.length) throw err;
        const delayMs = retryDelays[attempt] ?? 1000;
        attempt += 1;
        await abortableSleep(delayMs, signal);
        if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
        if (paused || pauseGeneration !== gen || signal.aborted) return;
        if (err instanceof ApiError && err.status === 403) {
          await refreshSession();
        }
      }
    }
  }

  async function uploadAllParts(): Promise<void> {
    emit("uploading");
    while (completedEtags.size < totalParts) {
      if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
      if (paused) await waitWhilePaused();
      if (needsRefreshBeforeUpload) {
        needsRefreshBeforeUpload = false;
        await refreshSession();
        emit("uploading");
        continue;
      }

      const queue: number[] = [];
      for (let p = 1; p <= totalParts; p += 1) {
        if (!completedEtags.has(p)) queue.push(p);
      }
      if (queue.length === 0) break;

      const passGen = pauseGeneration;
      const passSignal = inFlightAbort.signal;
      let queueIdx = 0;
      const workerCount = Math.min(concurrency, queue.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (!paused && !canceled && pauseGeneration === passGen && !passSignal.aborted) {
          const nextIdx = queueIdx;
          queueIdx += 1;
          if (nextIdx >= queue.length) return;
          await uploadSinglePart(queue[nextIdx]!, passGen, passSignal);
        }
      });
      await Promise.all(workers);
    }
  }

  async function completeSession(): Promise<ChunkedUploadResult> {
    if (!sessionId) {
      throw new ChunkedUploadError("malformed_response", "Cannot complete without sessionId");
    }
    emit("verifying");

    const parts = Array.from({ length: totalParts }, (_, i) => ({
      part_number: i + 1,
      etag: completedEtags.get(i + 1) ?? "",
    }));

    while (true) {
      if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
      try {
        let out: ChunkedUploadResult | null = null;
        if (opts.target.kind === "frame") {
          const upload = await completeFrameUploadSession(
            opts.target.documentId,
            sessionId,
            { parts },
            {
              frameToken: opts.target.frameToken,
              fetch: opts.fetch,
              signal: inFlightAbort.signal,
            },
          );
          if (upload) out = { kind: "upload", upload };
        } else {
          out = await completeUploadSession(
            sessionId,
            { parts },
            { fetch: opts.fetch, signal: inFlightAbort.signal },
          );
        }

        if (!out) {
          throw new ChunkedUploadError("malformed_response", "Malformed complete response");
        }
        if (opts.storage) clearResumableUpload(opts.storage, fileKey, opts.target);
        emit("done");
        return out;
      } catch (err) {
        if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
        if (err instanceof ApiError && err.status === 409 && err.code === "upload_session_busy") {
          const fieldRetry =
            typeof err.fields?.retry_after === "number" && Number.isFinite(err.fields.retry_after)
              ? err.fields.retry_after
              : undefined;
          const waitSec = err.retryAfterSeconds ?? fieldRetry ?? 5;
          await abortableSleep(Math.max(1, waitSec) * 1000, inFlightAbort.signal);
          continue;
        }
        if (isClearedSessionError(err) && opts.storage) {
          clearResumableUpload(opts.storage, fileKey, opts.target);
        }
        throw err;
      }
    }
  }

  async function run(): Promise<ChunkedUploadResult> {
    try {
      await openOrResumeSession();
      await uploadAllParts();
      return await completeSession();
    } catch (err) {
      if (canceled || (err instanceof ChunkedUploadError && err.code === "upload_canceled")) {
        if (currentPhase !== "canceled") emit("canceled");
        throw err instanceof ChunkedUploadError
          ? err
          : new ChunkedUploadError("upload_canceled", "Upload was canceled");
      }
      emit("failed");
      throw err;
    }
  }

  const result = run();
  result.catch(() => undefined);

  return {
    result,
    pause() {
      if (
        paused ||
        canceled ||
        currentPhase === "done" ||
        currentPhase === "failed" ||
        currentPhase === "canceled"
      ) {
        return;
      }
      paused = true;
      pauseGeneration += 1;
      needsRefreshBeforeUpload = true;
      inFlightAbort.abort();
      inFlightAbort = new AbortController();
      emit("paused");
    },
    resume() {
      if (!paused || canceled) return;
      paused = false;
      const waiters = pauseWaiters;
      pauseWaiters = [];
      for (const wake of waiters) wake();
    },
    async cancel() {
      if (canceled) return;
      canceled = true;
      paused = false;
      pauseGeneration += 1;
      inFlightAbort.abort();
      inFlightAbort = new AbortController();
      const waiters = pauseWaiters;
      pauseWaiters = [];
      for (const wake of waiters) wake();
      if (opts.storage) clearResumableUpload(opts.storage, fileKey, opts.target);
      if (sessionId) {
        const id = sessionId;
        try {
          if (opts.target.kind === "frame") {
            await abortFrameUploadSession(opts.target.documentId, id, {
              frameToken: opts.target.frameToken,
              fetch: opts.fetch,
            });
          } else {
            await abortUploadSession(id, { fetch: opts.fetch });
          }
        } catch (err) {
          if (!isClearedSessionError(err)) throw err;
        }
      }
      if (currentPhase !== "canceled") emit("canceled");
    },
  };
}
