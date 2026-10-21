import { ApiError } from "../../api/http";
import { buildUploadProbe } from "../chunked-upload/probe";
import {
  batchEnd,
  BUSY_WAIT_DEFAULT_S,
  createInvalidator,
  failureCode,
  fileKey,
  isExpired,
  isRetryableCode,
  isTransient,
  newIdempotencyKey,
  planBody,
  RETRY_DELAYS_MS,
  sleep,
  withRetry,
} from "./runner-helpers";
import type {
  FolderUploadFailedFile,
  FolderUploadHandle,
  FolderUploadPhase,
  FolderUploadReport,
  RunFolderUploadOptions,
} from "./runner-types";
import {
  asFolderUploadRefusal,
  type FileTarget,
  type FolderUploadBatch,
  type FolderUploadCompleteItem,
  type FolderUploadCompleteResponse,
  type StoredObject,
} from "./transport";
import type { PlannedFile } from "./types";

// The folder-upload runner (CONTRACT section 5, v0.2 wire): one plan call,
// `parallel` PUTs straight to storage, completes in batches, and a report.
// Pure apart from timers: the transport is injected, so the desktop app and
// the tests run the same code.

/** The oldest file waiting in the complete buffer waits at most this long. */
const MAX_WAIT_FLUSH_MS = 1_500;

type LocalStatus = "queued" | "stored" | "done" | "failed";

interface FileState {
  key: string;
  planned: PlannedFile;
  status: LocalStatus;
  code?: string;
  reason?: string;
  /** For a failed file: the server never decided on it, so a retry can send it again. */
  retryable: boolean;
  target: FileTarget | null;
  storedParts: Map<number, string>;
  /** What storage answered; kept so a failed complete never sends the bytes again. */
  object: StoredObject | null;
}

const completeItem = (f: FileState): FolderUploadCompleteItem => ({ file_key: f.key, ...(f.object as StoredObject) });

export function runFolderUpload(opts: RunFolderUploadOptions): FolderUploadHandle {
  const { transport, plan, limits } = opts;
  const parallel = Math.max(1, limits.parallel);
  const completeBatch = Math.max(1, limits.completeBatch);
  const idempotencyKey = opts.idempotencyKey ?? newIdempotencyKey();
  const buildProbe = opts.buildProbe ?? buildUploadProbe;
  const invalidator = createInvalidator(opts.onInvalidate);
  const files = new Map<string, FileState>(
    plan.files.map((planned, i) => [
      fileKey(i),
      { key: fileKey(i), planned, status: "queued", retryable: false, target: null, storedParts: new Map(), object: null },
    ]),
  );

  let controller = new AbortController();
  let phase: FolderUploadPhase = "planning";
  let ended: "canceled" | "expired" | null = null;
  let batchId: string | null = null;
  let root: FolderUploadReport["root"] = plan.rootTitle === null ? null : { id: null, title: plan.rootTitle };
  let buffer: FileState[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const inflightCompletes = new Set<Promise<void>>();
  let refreshing: Promise<boolean> | null = null;
  let cancelCall: Promise<unknown> = Promise.resolve();
  let running: Promise<FolderUploadReport>;

  const all = () => [...files.values()];
  const stopped = () => ended !== null;
  const count = (status: LocalStatus) => all().filter((f) => f.status === status).length;

  function emit(): void {
    const list = all();
    const sentBytes = list.reduce((sum, f) => sum + (f.status === "stored" || f.status === "done" ? f.planned.size : 0), 0);
    opts.onProgress?.({
      done: count("done"),
      failed: count("failed"),
      stored: count("stored"),
      total: list.length,
      sentBytes,
      totalBytes: plan.totals.bytes,
      phase,
    });
  }

  function report(): FolderUploadReport {
    const failed: FolderUploadFailedFile[] = all()
      .filter((f) => f.status === "failed")
      .map((f) => ({
        path: f.planned.path,
        filename: f.planned.filename,
        code: f.code ?? "unknown",
        ...(f.reason !== undefined ? { reason: f.reason } : {}),
        retryable: f.retryable,
      }));
    return {
      batchId,
      root,
      done: count("done"),
      failed,
      total: files.size,
      canceled: ended === "canceled",
      expired: ended === "expired",
      canRetry: batchId !== null && ended === null && failed.some((f) => f.retryable),
    };
  }

  function end(kind: "canceled" | "expired"): void {
    if (ended) return;
    ended = kind;
    phase = kind;
    controller.abort();
    if (flushTimer) clearTimeout(flushTimer);
    buffer = [];
  }

  function fail(f: FileState, code: string, reason?: string, retryable = isRetryableCode(code)): void {
    f.status = "failed";
    f.code = code;
    f.reason = reason;
    f.retryable = retryable;
    emit();
  }

  /** A fresh target: the parts it lists are the ones the server still wants. */
  function setTarget(f: FileState, target: FileTarget): void {
    f.target = target;
    if (target.kind === "multipart") for (const p of target.parts) f.storedParts.delete(p.part_number);
  }

  /** Take the server's view: done/failed as it says, fresh targets for pending files. */
  function absorb(batch: FolderUploadBatch): void {
    for (const sf of batch.files) {
      const f = files.get(sf.file_key);
      if (!f) continue;
      if (sf.status === "done") {
        f.status = "done";
      } else if (sf.status === "pending" && sf.target && f.status === "queued") {
        setTarget(f, sf.target);
      }
    }
  }

  function refresh(): Promise<boolean> {
    const signal = controller.signal;
    refreshing ??= withRetry(() => transport.status(batchId as string, { signal }), signal)
      .then((batch) => {
        absorb(batch);
        return true;
      })
      .catch((err: unknown) => {
        const kind = batchEnd(err);
        if (kind) end(kind);
        return false;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  /** Apply one complete answer; returns the files it gave no result for. */
  function applyResults(sent: FileState[], res: FolderUploadCompleteResponse): FileState[] {
    const byKey = new Map(res.results.map((r) => [r.file_key, r]));
    const unanswered: FileState[] = [];
    let anyDone = false;
    for (const f of sent) {
      const r = byKey.get(f.key);
      if (!r) {
        unanswered.push(f);
      } else if (r.status === "done") {
        f.status = "done";
        anyDone = true;
      } else {
        f.status = "failed";
        f.code = r.error?.code ?? "unknown";
        f.reason = r.error?.reason;
        // Without the server's flag a per-file failure is the server's final word.
        f.retryable = r.retryable ?? false;
        // Retryable at the server means the stored bytes are unusable: send them again.
        if (f.retryable) f.object = null;
      }
    }
    if (anyDone) invalidator.request();
    emit();
    return unanswered;
  }

  async function sendComplete(sent: FileState[]): Promise<void> {
    const signal = controller.signal;
    let left = sent;
    try {
      for (let retries = 0; ; retries += 1) {
        const items = left.map(completeItem);
        left = applyResults(left, await withRetry(() => transport.complete(batchId as string, items, { signal }), signal));
        if (left.length === 0 || retries >= RETRY_DELAYS_MS.length) break;
        await sleep(RETRY_DELAYS_MS[retries] as number, signal);
      }
      // Never answered: still pending at the server, the bytes are kept.
      for (const f of left) fail(f, "unknown", undefined, true);
    } catch (err) {
      if (stopped()) return;
      const kind = batchEnd(err);
      if (kind) return end(kind);
      const code = failureCode(err);
      const retryable = isRetryableCode(code) || (err instanceof ApiError && err.status === 429);
      for (const f of left) fail(f, code, undefined, retryable);
    }
  }

  function flushOne(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (stopped() || buffer.length === 0) return;
    const p = sendComplete(buffer.splice(0, completeBatch)).finally(() => inflightCompletes.delete(p));
    inflightCompletes.add(p);
    if (buffer.length > 0) flushTimer = setTimeout(flushOne, MAX_WAIT_FLUSH_MS);
  }

  /** Buffer a stored file; the timer runs from the first file of a buffer, not the last (max-wait). */
  function enqueue(f: FileState): void {
    buffer.push(f);
    if (buffer.length >= completeBatch) flushOne();
    else flushTimer ??= setTimeout(flushOne, MAX_WAIT_FLUSH_MS);
  }

  function stored(f: FileState, object: StoredObject): void {
    f.status = "stored";
    f.object = object;
    emit();
    enqueue(f);
  }

  async function uploadOne(f: FileState): Promise<void> {
    const blob = opts.file(f.planned.index);
    let retries = 0;
    let refreshed = false;
    for (;;) {
      if (stopped()) return;
      // The clock check only saves a PUT; after one refresh the PUT decides
      // (a client clock ahead of the server would fail every file otherwise).
      if (!f.target || (!refreshed && isExpired(f.target))) {
        if (refreshed) return fail(f, "target_expired");
        refreshed = true;
        f.target = null;
        const ok = await refresh();
        if (stopped()) return;
        if (!ok) return fail(f, "target_expired");
        if (f.status === "done") return emit();
        continue;
      }
      try {
        return stored(f, await transport.put(f.target, blob, { signal: controller.signal, storedParts: f.storedParts }));
      } catch (err) {
        if (stopped()) return;
        const kind = batchEnd(err);
        if (kind) return end(kind);
        if (err instanceof ApiError && err.status === 403 && !refreshed) {
          // A refused signature reads as expired: one fresh target.
          f.target = null;
          continue;
        }
        if (isTransient(err) && retries < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[retries] as number;
          retries += 1;
          try {
            await sleep(delay, controller.signal);
          } catch {
            return;
          }
          continue;
        }
        return fail(f, failureCode(err));
      }
    }
  }

  async function uploadAll(queue: FileState[]): Promise<void> {
    const worker = async () => {
      for (let f = queue.shift(); f && !stopped(); f = queue.shift()) await uploadOne(f);
    };
    await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));
    while (!stopped() && buffer.length > 0) flushOne();
    while (inflightCompletes.size > 0) await Promise.all([...inflightCompletes]);
  }

  /**
   * Cancel all: what landed stays, so the files whose bytes are in storage
   * are completed first (errors ignored), then the batch is canceled.
   */
  async function closeBatch(id: string, landed: FileState[]): Promise<void> {
    for (let i = 0; i < landed.length; i += completeBatch) {
      const chunk = landed.slice(i, i + completeBatch);
      try {
        applyResults(chunk, await transport.complete(id, chunk.map(completeItem)));
      } catch {
        // The batch is canceled either way; these files are simply not kept.
      }
    }
    await transport.cancel(id).catch(() => undefined);
  }

  async function finish(): Promise<FolderUploadReport> {
    await cancelCall;
    if (!ended) phase = "finished";
    if (batchId) invalidator.final();
    emit();
    return report();
  }

  async function planAndRun(): Promise<FolderUploadReport> {
    emit();
    const probes = new Map<number, Awaited<ReturnType<typeof buildUploadProbe>>>();
    const threshold = limits.chunkedThresholdBytes;
    if (threshold !== undefined) {
      for (const [i, f] of plan.files.entries()) {
        if (f.size > threshold) probes.set(i, await buildProbe(opts.file(f.index)));
      }
    }
    const body = planBody(plan, opts, probes);
    let busyWaited = false;
    let batch: FolderUploadBatch | null = null;
    while (!batch) {
      if (stopped()) return finish();
      try {
        batch = await transport.plan(body, { idempotencyKey, signal: controller.signal });
      } catch (err) {
        if (stopped()) return finish();
        const refusal = asFolderUploadRefusal(err);
        if (refusal?.code === "folder_uploads_busy" && !busyWaited) {
          busyWaited = true;
          phase = "waiting";
          emit();
          const seconds = Number(refusal.fields.retry_after);
          try {
            await sleep((Number.isFinite(seconds) && seconds >= 0 ? seconds : BUSY_WAIT_DEFAULT_S) * 1_000, controller.signal);
          } catch {
            return finish();
          }
          phase = "planning";
          emit();
          continue;
        }
        phase = "refused";
        emit();
        throw refusal ?? err;
      }
    }
    batchId = batch.id;
    if (plan.rootTitle !== null) root = { id: batch.root_folder_id, title: batch.root_title || plan.rootTitle };
    for (const f of files.values()) {
      if (!batch.files.some((sf) => sf.file_key === f.key)) fail(f, "not_found", undefined, false);
    }
    absorb(batch);
    invalidator.request();
    phase = "uploading";
    emit();
    await uploadAll(all().filter((f) => f.status === "queued"));
    return finish();
  }

  async function retryRun(): Promise<FolderUploadReport> {
    controller = new AbortController();
    const signal = controller.signal;
    phase = "retrying";
    emit();
    let batch: FolderUploadBatch;
    try {
      batch = await withRetry(() => transport.status(batchId as string, { signal }), signal);
    } catch (err) {
      const kind = batchEnd(err);
      if (kind) {
        end(kind);
        return finish();
      }
      phase = "finished";
      emit();
      throw err;
    }
    const queue: FileState[] = [];
    for (const sf of batch.files) {
      const f = files.get(sf.file_key);
      if (!f || f.status !== "failed") continue;
      if (sf.status === "done") {
        f.status = "done";
      } else if (sf.status === "pending" && (f.object || sf.target)) {
        f.code = undefined;
        f.reason = undefined;
        if (f.object) {
          // The bytes are in storage already: only the complete is missing.
          f.status = "stored";
          enqueue(f);
        } else {
          f.status = "queued";
          setTarget(f, sf.target as FileTarget);
          queue.push(f);
        }
      } else if (sf.status === "failed") {
        f.code = sf.error?.code ?? f.code;
        f.reason = sf.error?.reason;
        f.retryable = false;
      }
    }
    await uploadAll(queue);
    return finish();
  }

  const done = planAndRun();
  running = done;

  return {
    done,
    cancel() {
      if (ended || phase === "refused") return;
      const landed = all().filter((f) => f.status === "stored" && f.object);
      end("canceled");
      if (batchId) cancelCall = closeBatch(batchId, landed);
      emit();
    },
    retryFailed() {
      // Chained on the previous run, so a second click waits instead of racing it.
      const next = running
        .catch(() => report())
        .then((last) => (last.canRetry && !ended ? retryRun() : report()));
      running = next;
      return next;
    },
  };
}
