import { ApiError } from "../../api/http";
import { buildUploadProbe } from "../chunked-upload/probe";
import type {
  FolderUploadFailedFile,
  FolderUploadHandle,
  FolderUploadPhase,
  FolderUploadReport,
  RunFolderUploadOptions,
} from "./runner-types";
import {
  asFolderUploadRefusal,
  FolderUploadError,
  type FileTarget,
  type FolderUploadBatch,
  type FolderUploadCompleteItem,
  type FolderUploadPlanBody,
} from "./transport";
import type { FolderUploadPlan, PlannedFile } from "./types";

// The folder-upload runner (CONTRACT section 5, v0.2 wire): one plan call,
// `parallel` PUTs straight to storage, completes in batches, and a report.
// Pure apart from timers: the transport is injected, so the desktop app and
// the tests run the same code.

const RETRY_DELAYS_MS = [1_000, 3_000];
const IDLE_FLUSH_MS = 1_500;
const INVALIDATE_EVERY_MS = 2_000;
const BUSY_WAIT_DEFAULT_S = 30;

type LocalStatus = "queued" | "stored" | "done" | "failed";

interface FileState {
  key: string;
  planned: PlannedFile;
  status: LocalStatus;
  code?: string;
  reason?: string;
  target: FileTarget | null;
  storedParts: Map<number, string>;
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

/** Strip the root segment: the wire paths are under the root, which is "". */
function underRoot(path: string): string {
  const slash = path.indexOf("/");
  return slash < 0 ? "" : path.slice(slash + 1);
}

function fileKey(position: number): string {
  return `f-${String(position + 1).padStart(4, "0")}`;
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `fu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isExpired(target: FileTarget): boolean {
  const at = Date.parse(target.expires_at);
  return Number.isFinite(at) && at <= Date.now();
}

/** Network failures and 5xx are worth another attempt; nothing else is. */
function isTransient(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof ApiError && err.status >= 500);
}

function failureCode(err: unknown): string {
  if (err instanceof FolderUploadError) return err.code;
  if (err instanceof ApiError) return err.code && err.code !== "internal" ? err.code : `http_${err.status}`;
  if (err instanceof TypeError) return "network";
  return "unknown";
}

/** 410 expired, or 409 canceled elsewhere: nothing more can happen in this batch. */
function batchEnd(err: unknown): "expired" | "canceled" | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 410) return "expired";
  if (err.status === 409 && err.code === "folder_upload_canceled") return "canceled";
  return null;
}

/** At most one call per window, the last request of a window deferred to its end. */
function createInvalidator(cb: (() => void) | undefined) {
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    timer = null;
    last = Date.now();
    cb?.();
  };
  return {
    request() {
      if (!cb || timer) return;
      const wait = last + INVALIDATE_EVERY_MS - Date.now();
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    final() {
      if (timer) clearTimeout(timer);
      fire();
    },
  };
}

function planBody(
  plan: FolderUploadPlan,
  opts: RunFolderUploadOptions,
  probes: Map<number, Awaited<ReturnType<typeof buildUploadProbe>>>,
): FolderUploadPlanBody {
  return {
    parent_id: opts.parentId,
    root_name: plan.rootName,
    share_with_workspace: opts.shareWithWorkspace,
    folders: plan.folders.filter((f) => f.includes("/")).map(underRoot),
    files: plan.files.map((f, i) => {
      const probe = probes.get(i);
      return {
        file_key: fileKey(i),
        path: underRoot(f.folderPath),
        filename: f.filename,
        size_bytes: f.size,
        ...(probe ? { probe } : {}),
      };
    }),
  };
}

export function runFolderUpload(opts: RunFolderUploadOptions): FolderUploadHandle {
  const { transport, plan, limits } = opts;
  const parallel = Math.max(1, limits.parallel);
  const completeBatch = Math.max(1, limits.completeBatch);
  const idempotencyKey = opts.idempotencyKey ?? newIdempotencyKey();
  const buildProbe = opts.buildProbe ?? buildUploadProbe;
  const invalidator = createInvalidator(opts.onInvalidate);
  const files = new Map<string, FileState>(
    plan.files.map((planned, i) => [fileKey(i), { key: fileKey(i), planned, status: "queued", target: null, storedParts: new Map() }]),
  );

  let controller = new AbortController();
  let phase: FolderUploadPhase = "planning";
  let ended: "canceled" | "expired" | null = null;
  let batchId: string | null = null;
  let root: { id: string | null; title: string } = { id: null, title: plan.rootTitle };
  let buffer: FolderUploadCompleteItem[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const inflightCompletes = new Set<Promise<void>>();
  let refreshing: Promise<boolean> | null = null;
  let cancelCall: Promise<unknown> = Promise.resolve();
  let running: Promise<FolderUploadReport>;

  const all = () => [...files.values()];
  const stopped = () => ended !== null;

  function emit(): void {
    const list = all();
    const sentBytes = list.reduce((sum, f) => sum + (f.status === "stored" || f.status === "done" ? f.planned.size : 0), 0);
    opts.onProgress?.({
      done: list.filter((f) => f.status === "done").length,
      failed: list.filter((f) => f.status === "failed").length,
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
      }));
    return {
      batchId,
      root,
      done: all().filter((f) => f.status === "done").length,
      failed,
      total: files.size,
      canceled: ended === "canceled",
      expired: ended === "expired",
      canRetry: batchId !== null && ended === null && failed.length > 0,
    };
  }

  function end(kind: "canceled" | "expired"): void {
    if (ended) return;
    ended = kind;
    phase = kind;
    controller.abort();
    if (idleTimer) clearTimeout(idleTimer);
    buffer = [];
  }

  function fail(f: FileState, code: string, reason?: string): void {
    f.status = "failed";
    f.code = code;
    f.reason = reason;
    emit();
  }

  /** Take the server's view: done/failed as it says, fresh targets for pending files. */
  function absorb(batch: FolderUploadBatch): void {
    for (const sf of batch.files) {
      const f = files.get(sf.file_key);
      if (!f) continue;
      if (sf.status === "done") {
        f.status = "done";
      } else if (sf.status === "pending" && sf.target && f.status === "queued") {
        f.target = sf.target;
      }
    }
  }

  function refresh(): Promise<boolean> {
    refreshing ??= transport
      .status(batchId as string, { signal: controller.signal })
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

  async function sendComplete(items: FolderUploadCompleteItem[]): Promise<void> {
    try {
      const res = await transport.complete(batchId as string, items, { signal: controller.signal });
      const byKey = new Map(res.results.map((r) => [r.file_key, r]));
      let anyDone = false;
      for (const item of items) {
        const f = files.get(item.file_key);
        const r = byKey.get(item.file_key);
        if (!f) continue;
        if (r?.status === "done") {
          f.status = "done";
          anyDone = true;
        } else {
          f.status = "failed";
          f.code = r?.error?.code ?? "unknown";
          f.reason = r?.error?.reason;
        }
      }
      if (anyDone) invalidator.request();
      emit();
    } catch (err) {
      if (stopped()) return;
      const kind = batchEnd(err);
      if (kind) return end(kind);
      for (const item of items) {
        const f = files.get(item.file_key);
        if (f) fail(f, failureCode(err));
      }
    }
  }

  function flushOne(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (stopped() || buffer.length === 0) return;
    const items = buffer.splice(0, completeBatch);
    const p = sendComplete(items).finally(() => inflightCompletes.delete(p));
    inflightCompletes.add(p);
  }

  function stored(f: FileState, item: FolderUploadCompleteItem): void {
    f.status = "stored";
    emit();
    buffer.push(item);
    if (buffer.length >= completeBatch) {
      flushOne();
    } else {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(flushOne, IDLE_FLUSH_MS);
    }
  }

  async function uploadOne(f: FileState): Promise<void> {
    const blob = opts.file(f.planned.index);
    let retries = 0;
    let refreshed = false;
    for (;;) {
      if (stopped()) return;
      if (!f.target || isExpired(f.target)) {
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
        const object = await transport.put(f.target, blob, { signal: controller.signal, storedParts: f.storedParts });
        return stored(f, { file_key: f.key, ...object });
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
    phase = "uploading";
    emit();
    const worker = async () => {
      for (let f = queue.shift(); f && !stopped(); f = queue.shift()) await uploadOne(f);
    };
    await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));
    while (!stopped() && buffer.length > 0) flushOne();
    while (inflightCompletes.size > 0) await Promise.all([...inflightCompletes]);
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
    root = { id: batch.root_folder_id, title: batch.root_title || plan.rootTitle };
    for (const f of files.values()) {
      if (!batch.files.some((sf) => sf.file_key === f.key)) fail(f, "not_found");
    }
    absorb(batch);
    invalidator.request();
    await uploadAll(all().filter((f) => f.status === "queued"));
    return finish();
  }

  async function retryRun(): Promise<FolderUploadReport> {
    controller = new AbortController();
    phase = "uploading";
    let batch: FolderUploadBatch;
    try {
      batch = await transport.status(batchId as string, { signal: controller.signal });
    } catch (err) {
      const kind = batchEnd(err);
      if (kind) {
        end(kind);
        return finish();
      }
      throw err;
    }
    const queue: FileState[] = [];
    for (const sf of batch.files) {
      const f = files.get(sf.file_key);
      if (!f || f.status === "done") continue;
      if (sf.status === "done") {
        f.status = "done";
      } else if (sf.status === "pending" && sf.target) {
        f.status = "queued";
        f.code = undefined;
        f.reason = undefined;
        f.target = sf.target;
        queue.push(f);
      } else if (sf.status === "failed" && sf.error) {
        f.status = "failed";
        f.code = sf.error.code;
        f.reason = sf.error.reason;
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
      end("canceled");
      if (batchId) cancelCall = transport.cancel(batchId).catch(() => undefined);
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
