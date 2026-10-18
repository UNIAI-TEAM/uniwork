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
import { clearResumableUpload, findResumableUpload, saveResumableUpload, uploadFileKey } from "./resume";
import type { UploadSessionTarget } from "./target";

export type ChunkedUploadPhase = "probing" | "opening" | "uploading" | "paused" | "verifying" | "done" | "failed" | "canceled";

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
const TERMINAL_COMPLETE_CODES = new Set([
  "unsupported_media_type",
  "file_too_large",
  "upload_size_mismatch",
  "upload_probe_mismatch",
]);

function isClearedSessionError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 404 || err.status === 410 || err.code === "upload_session_expired")
  );
}

function isTerminalCompleteError(err: unknown): boolean {
  return (
    isClearedSessionError(err) ||
    (err instanceof ApiError &&
      (err.status === 413 ||
        err.status === 415 ||
        (err.code !== undefined && TERMINAL_COMPLETE_CODES.has(err.code))))
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
  let sessionExpiresAt = "";
  let partSize = 0;
  let totalParts = 0;
  let maxSentBytes = 0;
  const completedEtags = new Map<number, string>();
  const partUrls = new Map<number, UploadSessionPartURL>();
  // Bytes the transport has already handed over for a part that is still
  // going, so the bar moves during the first 8 MiB part (V-1). Cleared when
  // that part settles, retries included.
  const inFlightBytes = new Map<number, number>();
  // Bytes the transport already reported for a part whose send was then
  // abandoned (pause abort, superseded pass): banked so the restarted send
  // keeps the bar moving from the first new byte instead of holding still
  // (R2-F1). Counted like fresh in-flight bytes and released when the part
  // completes locally or the server claims it.
  const restartBaseline = new Map<number, number>();

  let currentPhase: ChunkedUploadPhase = "probing";
  let paused = false;
  let canceled = false;
  let pauseGeneration = 0;
  let needsRefreshBeforeUpload = false;
  let pauseWaiters: (() => void)[] = [];
  const cancelAbort = new AbortController();
  let partPutAbort = new AbortController();
  let refreshPromise: Promise<void> | null = null;

  function partByteLength(partNumber: number): number {
    if (totalParts <= 0 || partSize <= 0) return 0;
    const start = (partNumber - 1) * partSize;
    return Math.max(0, Math.min(totalBytes, start + partSize) - start);
  }

  function computeSentBytes(): number {
    let sum = 0;
    for (const partNumber of completedEtags.keys()) sum += partByteLength(partNumber);
    for (const [partNumber, banked] of restartBaseline) {
      if (completedEtags.has(partNumber)) continue;
      const covered = banked + (inFlightBytes.get(partNumber) ?? 0);
      sum += Math.min(covered, partByteLength(partNumber));
    }
    for (const [partNumber, loaded] of inFlightBytes) {
      if (completedEtags.has(partNumber) || restartBaseline.has(partNumber)) continue;
      sum += Math.min(loaded, partByteLength(partNumber));
    }
    maxSentBytes = Math.max(maxSentBytes, Math.min(totalBytes, sum));
    return maxSentBytes;
  }

  function emit(phase: ChunkedUploadPhase): void {
    currentPhase = phase;
    const sentBytes = phase === "done" ? totalBytes : computeSentBytes();
    opts.onProgress?.({ phase, sentBytes, totalBytes, ...(sessionId ? { sessionId } : {}) });
  }

  // A send that ended without an etag still moved bytes; keep them for the
  // restarted attempt's accounting.
  function bankAbandonedBytes(partNumber: number): void {
    const abandoned = inFlightBytes.get(partNumber) ?? 0;
    inFlightBytes.delete(partNumber);
    if (abandoned > 0) {
      restartBaseline.set(partNumber, (restartBaseline.get(partNumber) ?? 0) + abandoned);
    }
  }

  // The resume record carries how many parts the server has confirmed so a
  // later page knows there is real progress behind it (R2-F2); refreshed on
  // every snapshot and every completed part.
  function persistResumeRecord(): void {
    if (!opts.storage || !sessionId) return;
    saveResumableUpload(opts.storage, fileKey, opts.target, {
      session_id: sessionId,
      expires_at: sessionExpiresAt,
      idempotency_key: opts.idempotencyKey,
      completed_parts: completedEtags.size,
    });
  }

  function applySessionSnapshot(session: UploadSession): void {
    sessionId = session.session_id;
    sessionExpiresAt = session.expires_at;
    partSize = session.part_size;
    totalParts = session.total_parts;
    for (const cp of session.completed_parts) {
      completedEtags.set(cp.part_number, cp.etag);
      inFlightBytes.delete(cp.part_number);
      restartBaseline.delete(cp.part_number);
    }
    for (const p of session.parts) partUrls.set(p.part_number, p);
    persistResumeRecord();
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
        signal: cancelAbort.signal,
      });
    }
    return getUploadSession(id, { signal: cancelAbort.signal });
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

    const reqOpts = { idempotencyKey: opts.idempotencyKey, signal: cancelAbort.signal };
    const body = { filename: opts.filename, size_bytes: totalBytes, probe };
    let created: UploadSession | null = null;
    if (opts.target.kind === "workspace") {
      created = await createWorkspaceUploadSession(
        opts.target.workspaceId,
        {
          ...body,
          parent_id: opts.target.parentId,
          title: opts.target.title,
          visibility: opts.target.visibility,
        },
        reqOpts,
      );
    } else if (opts.target.kind === "version") {
      created = await createDocumentUploadSession(opts.target.documentId, body, reqOpts);
    } else {
      created = await createFrameUploadSession(opts.target.documentId, body, {
        ...reqOpts,
        frameToken: opts.target.frameToken,
        fetch: opts.fetch,
      });
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
        if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
        if (paused || pauseGeneration !== gen || signal.aborted) return;
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
      inFlightBytes.set(partNumber, 0);

      try {
        const etag = await putUploadSessionPart(partMeta.url, chunk, {
          headers: partMeta.headers,
          signal,
          fetch: opts.fetch,
          onProgress: (loaded) => {
            inFlightBytes.set(partNumber, loaded);
            if (canceled || paused || pauseGeneration !== gen || signal.aborted) return;
            emit("uploading");
          },
        });
        if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
        if (paused || pauseGeneration !== gen || signal.aborted) return;
        if (!etag) {
          throw new ChunkedUploadError("missing_etag", `Missing ETag on part ${partNumber}`);
        }
        inFlightBytes.delete(partNumber);
        restartBaseline.delete(partNumber);
        completedEtags.set(partNumber, etag);
        persistResumeRecord();
        emit("uploading");
        return;
      } catch (err) {
        if (canceled) {
          inFlightBytes.delete(partNumber);
          throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
        }
        if (paused || pauseGeneration !== gen || signal.aborted) {
          bankAbandonedBytes(partNumber);
          return;
        }
        // A retry sends the part from byte 0 again, so the failed attempt's
        // bytes must not be banked or the bar would run ahead of real progress.
        inFlightBytes.delete(partNumber);
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
    if (!paused) emit("uploading");
    while (completedEtags.size < totalParts) {
      if (canceled) throw new ChunkedUploadError("upload_canceled", "Upload was canceled");
      if (paused) await waitWhilePaused();
      if (needsRefreshBeforeUpload) {
        needsRefreshBeforeUpload = false;
        await refreshSession();
        if (!paused) emit("uploading");
        continue;
      }

      const queue: number[] = [];
      for (let p = 1; p <= totalParts; p += 1) {
        if (!completedEtags.has(p)) queue.push(p);
      }
      if (queue.length === 0) break;

      const passGen = pauseGeneration;
      const passSignal = partPutAbort.signal;
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
              signal: cancelAbort.signal,
            },
          );
          if (upload) out = { kind: "upload", upload };
        } else {
          out = await completeUploadSession(sessionId, { parts }, { signal: cancelAbort.signal });
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
          await abortableSleep(Math.max(1, waitSec) * 1000, cancelAbort.signal);
          continue;
        }
        if (isTerminalCompleteError(err) && opts.storage) {
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

  function wakeWaiters(): void {
    const waiters = pauseWaiters;
    pauseWaiters = [];
    for (const wake of waiters) wake();
  }

  return {
    result,
    pause() {
      if (paused || canceled || ["verifying", "done", "failed", "canceled"].includes(currentPhase)) {
        return;
      }
      paused = true;
      pauseGeneration += 1;
      needsRefreshBeforeUpload = true;
      partPutAbort.abort();
      partPutAbort = new AbortController();
      emit("paused");
    },
    resume() {
      if (!paused || canceled) return;
      paused = false;
      wakeWaiters();
    },
    async cancel() {
      if (canceled) return;
      canceled = true;
      paused = false;
      pauseGeneration += 1;
      cancelAbort.abort();
      partPutAbort.abort();
      partPutAbort = new AbortController();
      wakeWaiters();
      if (currentPhase !== "canceled") emit("canceled");
      const id =
        sessionId ??
        (opts.storage ? findResumableUpload(opts.storage, fileKey, opts.target)?.session_id : undefined);
      if (id) {
        try {
          if (opts.target.kind === "frame") {
            await abortFrameUploadSession(opts.target.documentId, id, {
              frameToken: opts.target.frameToken,
              fetch: opts.fetch,
            });
          } else {
            await abortUploadSession(id);
          }
          if (opts.storage) clearResumableUpload(opts.storage, fileKey, opts.target);
        } catch (err) {
          if (isClearedSessionError(err) && opts.storage) {
            clearResumableUpload(opts.storage, fileKey, opts.target);
          }
        }
      }
    },
  };
}
